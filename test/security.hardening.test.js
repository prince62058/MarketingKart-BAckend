// Second hardening pass: WhatsApp/RCS controls, webhook handshakes, public forms, uploads, input
// limits, outbound URL fetches and password storage. Runs the real app against a throwaway mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;
let customer;
let customerToken;
let adminToken;
let staffToken;
const someId = "64b000000000000000000001";

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  delete process.env.META_LEAD_WEBHOOK_VERIFY_TOKEN;
  customer = await fixtures.makeUser();
  customerToken = fixtures.tokenFor(customer);
  adminToken = fixtures.tokenFor(await fixtures.makeAdmin());
  const limited = await fixtures.makeAdmin();
  await require("../src/models/staffModel").create({ userId: limited._id, role: "BDE", permissions: ["USERS"] });
  staffToken = fixtures.tokenFor(limited);
});

after(async () => {
  if (h) await h.close();
});

const refused = (status) => status === 401 || status === 403;

test("a customer cannot switch WhatsApp billing to their own Meta account", { skip }, async () => {
  const res = await h.call("PUT", "/api/whatsapp/account/billing-mode", { token: customerToken, body: { billingMode: "CUSTOMER" } });
  assert.equal(res.status, 403);
  const back = await h.call("PUT", "/api/whatsapp/account/billing-mode", { token: customerToken, body: { billingMode: "PLATFORM" } });
  assert.ok(!refused(back.status), `wallet billing stays the customer's choice (got ${back.status})`);
  const admin = await h.call("PUT", "/api/whatsapp/account/billing-mode", { token: adminToken, body: { billingMode: "CUSTOMER" } });
  assert.ok(!refused(admin.status));
});

test("RCS sends from a customer must use an https image", { skip }, async () => {
  const res = await h.call("POST", "/api/rcs/send", { token: customerToken, body: { recipients: [{ phone: "9876500000" }], templateName: "t", imageUrl: "http://169.254.169.254/x" } });
  assert.equal(res.status, 400);
});

test("WhatsApp and RCS price lists need the staff permission for them", { skip }, async () => {
  const routes = [
    ["POST", "/api/whatsapp/plans", {}],
    ["PUT", `/api/whatsapp/plans/${someId}`, {}],
    ["PUT", "/api/whatsapp/pricing/MARKETING", {}],
    ["GET", "/api/whatsapp/wallet/all-transactions"],
    ["POST", "/api/whatsapp/wallet/add-money", { userId: someId, amount: 10 }],
    ["POST", "/api/rcs/plans", {}],
    ["PUT", "/api/rcs/settings", {}],
    ["POST", "/api/whatsapp/chat/bot-plans", {}],
    ["PUT", "/api/whatsapp/chat/bot-settings", {}],
    ["PUT", "/api/whatsapp/account-menu", {}],
  ];
  for (const [method, route, body] of routes) {
    const staff = await h.call(method, route, { token: staffToken, body });
    assert.equal(staff.status, 403, `${method} ${route} let a USERS-only staff member through (${staff.status})`);
    const admin = await h.call(method, route, { token: adminToken, body });
    assert.notEqual(admin.status, 403, `${method} ${route} refused a full admin`);
  }
  const customerCredit = await h.call("POST", "/api/whatsapp/wallet/add-money", { token: customerToken, body: { userId: someId, amount: 1000 } });
  assert.equal(customerCredit.status, 403, "a customer still cannot credit a wallet");
});

test("webhook handshakes fail closed when no verify token is configured", { skip }, async () => {
  const wa = await h.call("GET", "/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=abc");
  assert.equal(wa.status, 403);
  const leadOld = await h.call("GET", "/api/webhook/getWebhook?hub.mode=subscribe&hub.verify_token=da21e0d80f1d406e99ff7b518fd3936b&hub.challenge=abc");
  assert.equal(leadOld.status, 403, "the token that used to be in the source code no longer works");

  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "configured-token";
  const ok = await h.call("GET", "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=configured-token&hub.challenge=<b>x</b>");
  assert.equal(ok.status, 200);
  assert.equal(ok.text, "<b>x</b>");
  delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
});

test("the public contact form cannot set its own status or owner", { skip }, async () => {
  const res = await h.call("POST", "/api/createContactUs", {
    body: { name: "Visitor", email: "visitor@example.test", phone: "9999999999", message: "hi", status: "RESOLVED", userId: String(customer._id) },
  });
  assert.equal(res.status, 201);
  const saved = await require("../src/models/contactUsModel").findOne({ email: "visitor@example.test" }).lean();
  assert.equal(saved.status, "PENDING");
  assert.equal(saved.userId, undefined);

  const signedIn = await h.call("POST", "/api/createContactUs", {
    token: customerToken,
    body: { name: "Customer", email: "signed.in@example.test", phone: "9999999998", message: "hi" },
  });
  assert.equal(signedIn.status, 201);
  const mine = await require("../src/models/contactUsModel").findOne({ email: "signed.in@example.test" }).lean();
  assert.equal(String(mine.userId), String(customer._id));
});

test("uploads refuse files a browser would run", { skip }, async () => {
  const form = new FormData();
  form.append("files", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "page.html");
  const res = await fetch(`${h.base}/api/imageVideoUpload`, { method: "POST", headers: { authorization: `Bearer ${customerToken}` }, body: form });
  assert.equal(res.status, 400);

  const svg = new FormData();
  svg.append("files", new Blob(["<svg onload=alert(1)>"], { type: "image/svg+xml" }), "logo.svg");
  const res2 = await fetch(`${h.base}/api/imageVideoUpload`, { method: "POST", headers: { authorization: `Bearer ${customerToken}` }, body: svg });
  assert.equal(res2.status, 400);
});

test("query input: operators are stripped, page sizes and search text are capped", () => {
  const { sanitizeInput } = require("../src/middlewares/security");
  const req = {
    body: { email: { $ne: null }, nested: [{ $where: "1" }] },
    query: { limit: "1000000", search: ["a", "b"], mobile: { $gt: "" }, pageSize: "-5" },
    params: {},
  };
  sanitizeInput(req, {}, () => {});
  assert.deepEqual(req.body.email, {});
  assert.deepEqual(req.body.nested, [{}]);
  assert.equal(req.query.limit, "1000");
  assert.equal(req.query.search, "a");
  assert.deepEqual(req.query.mobile, {});
  assert.equal(req.query.pageSize, undefined);

  const escapeRegex = require("../src/helpers/escapeRegex");
  assert.equal(escapeRegex("a.*(b)"), "a\\.\\*\\(b\\)");
  assert.equal(escapeRegex("x".repeat(500)).length, 100);
});

test("outbound fetches of customer links refuse internal addresses", async () => {
  const { assertPublicUrl, isPrivateAddress, publicLookup } = require("../src/helpers/safeUrl");
  for (const url of ["http://example.com/a.png", "https://localhost/a", "https://127.0.0.1/a", "https://169.254.169.254/latest", "https://10.1.2.3/", "https://[::1]/", "https://user:pw@example.com/", "file:///etc/passwd"]) {
    assert.throws(() => assertPublicUrl(url), undefined, url);
  }
  assert.equal(assertPublicUrl("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
  assert.ok(isPrivateAddress("192.168.1.1") && isPrivateAddress("::ffff:127.0.0.1") && isPrivateAddress("fd00::1"));
  assert.ok(!isPrivateAddress("8.8.8.8"));
  const err = await new Promise((resolve) => publicLookup("localhost", {}, (e) => resolve(e)));
  assert.equal(err?.code, "EPRIVATE");
});

test("passwords are stored with scrypt and old AES passwords are upgraded", () => {
  const CryptoJS = require("crypto-js");
  const { hashPassword, verifyPassword } = require("../src/helpers/passwordHash");
  assert.throws(() => hashPassword("short"));
  const stored = hashPassword("Correct horse 1");
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(hashPassword("Correct horse 1"), stored, "every hash has its own salt");
  assert.deepEqual(verifyPassword("Correct horse 1", stored), { ok: true, upgrade: false });
  assert.equal(verifyPassword("wrong password", stored).ok, false);

  const legacy = CryptoJS.AES.encrypt("Admin@123", "CRYPTOKEY").toString();
  assert.deepEqual(verifyPassword("Admin@123", legacy), { ok: true, upgrade: true });
  assert.equal(verifyPassword("Admin@124", legacy).ok, false);
});

test("the rate limiter refuses once the window is used up", () => {
  process.env.RATE_LIMIT_IN_TESTS = "1";
  try {
    const { rateLimit } = require("../src/middlewares/rateLimit");
    const limiter = rateLimit({ name: "unit", windowMs: 60000, max: 2 });
    const statuses = [];
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { statuses.push(code); return { json: () => {} }; } };
    let passed = 0;
    for (let i = 0; i < 3; i++) limiter({ ip: "1.2.3.4" }, res, () => { passed += 1; });
    assert.equal(passed, 2);
    assert.deepEqual(statuses, [429]);
  } finally {
    delete process.env.RATE_LIMIT_IN_TESTS;
  }
});
