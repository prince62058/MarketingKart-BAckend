// WhatsApp super admin: who may use it, what it shows, the money/plan actions it takes, and the
// feature switches and suspensions it enforces on the customer panel and the public API.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let admin;
let adminToken;
let staffToken;
let alice;
let aliceToken;
let bobToken;
let plan;
let apiSecret;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness({ env: { WHATSAPP_TOKEN_ENCRYPTION_KEY: "ab".repeat(32) } });
  const fixtures = require("./helpers/securityFixtures");
  admin = await fixtures.makeAdmin({ name: "Root" });
  adminToken = fixtures.tokenFor(admin);
  const limited = await fixtures.makeAdmin({ name: "Limited staff" });
  await require("../src/models/staffModel").create({ userId: limited._id, role: "STAFF", permissions: ["WA_PLANS"], isActive: true, businesses: [] });
  staffToken = fixtures.tokenFor(limited);
  alice = await fixtures.makeUser({ name: "Alice Traders", whatsappWallet: 50 });
  aliceToken = fixtures.tokenFor(alice);
  bobToken = fixtures.tokenFor(await fixtures.makeUser({ name: "Bob" }));
  await require("../src/models/whatsappAccountModel").create({ userId: alice._id, phoneNumberId: "pn-sa", wabaId: "waba-sa", phoneNumber: "+91 90000 22001", verifiedName: "Alice Traders", accessToken: "meta-secret-token", status: "CONNECTED", qualityRating: "YELLOW" });
  const Message = require("../src/models/whatsappMessageModel");
  await Message.create([
    { phoneNumberId: "pn-sa", to: "919800000001", direction: "OUTBOUND", type: "TEMPLATE", templateName: "promo", status: "DELIVERED", billSource: "wallet", billingState: "settled", billPaise: 110, billCategory: "MARKETING" },
    { phoneNumberId: "pn-sa", to: "919800000002", direction: "OUTBOUND", type: "TEMPLATE", templateName: "promo", status: "FAILED", errorCode: 131026, errorMessage: "Message undeliverable" },
    { phoneNumberId: "pn-sa", to: "919800000001", direction: "INBOUND", type: "TEXT", textBody: "Hi", status: "DELIVERED" },
  ]);
  plan = await require("../src/models/whatsappPlanModel").create({ title: "Growth", price: 999, duration: 30, marketingCredits: 500, utilityCredits: 100 });
  const key = await require("../src/services/whatsappDeveloperService").createKey(alice, "ERP");
  apiSecret = key.secret;
  await require("mongoose").models.whatsappControl.syncIndexes();
});

after(async () => {
  if (h) await h.close();
});

const call = (method, route, token, body) => h.call(method, `/api${route}`, { token, body });
const wallet = async () => Number((await require("../src/models/userModel").findById(alice._id).lean()).whatsappWallet);

test("only admins with the WA_ADMIN permission get in", { skip }, async () => {
  assert.equal((await call("GET", "/admin/whatsapp/overview", aliceToken)).status, 401);
  assert.equal((await call("GET", "/admin/whatsapp/overview")).status, 401);
  assert.equal((await call("GET", "/admin/whatsapp/overview", staffToken)).status, 403);
  const ok = await call("GET", "/admin/whatsapp/overview", adminToken);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.data.numbers.connected, 1);
  assert.equal(ok.body.data.numbers.quality.YELLOW, 1);
  assert.equal(ok.body.data.last24h.failed, 1);
  assert.equal(ok.body.data.last24h.received, 1);
  assert.equal(ok.body.data.money.messageSpend30d, 1.1);
  assert.equal(ok.body.data.perDay.length, 14);
  assert.equal(ok.body.data.recentFailures[0].errorMessage, "Message undeliverable");
  assert.equal(ok.body.data.recentFailures[0].user.name, "Alice Traders");
});

test("customers list and the 360 view never leak secrets", { skip }, async () => {
  const list = await call("GET", "/admin/whatsapp/customers?q=alice", adminToken);
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.data.total, 1);
  const row = list.body.data.rows[0];
  assert.equal(row.number.qualityRating, "YELLOW");
  assert.equal(row.usage30d.sent, 2);
  assert.equal(row.usage30d.failed, 1);
  assert.equal((await call("GET", "/admin/whatsapp/customers?q=22001", adminToken)).body.data.total, 1);

  const full = await call("GET", `/admin/whatsapp/customers/${alice._id}`, adminToken);
  assert.equal(full.status, 200, full.text);
  assert.ok(!full.text.includes("meta-secret-token"));
  assert.ok(!full.text.includes(apiSecret));
  assert.equal(full.body.data.account.phoneNumber, "+91 90000 22001");
  assert.equal(full.body.data.traffic30d.failed, 1);
  assert.equal(full.body.data.api.keys.length, 1);
  assert.equal(full.body.data.controls.effective.campaigns.enabled, true);
  assert.equal((await call("GET", "/admin/whatsapp/customers/nope", adminToken)).status, 404);
});

test("wallet, plan and credit changes are exact and audited", { skip }, async () => {
  const start = await wallet();
  assert.equal((await call("POST", `/admin/whatsapp/customers/${alice._id}/wallet`, adminToken, { amount: 25 })).status, 400);
  const credit = await call("POST", `/admin/whatsapp/customers/${alice._id}/wallet`, adminToken, { amount: 25, reason: "Goodwill" });
  assert.equal(credit.status, 200, credit.text);
  assert.equal(await wallet(), start + 25);
  const tooMuch = await call("POST", `/admin/whatsapp/customers/${alice._id}/wallet`, adminToken, { amount: -10000, reason: "Oops" });
  assert.equal(tooMuch.status, 409);
  assert.equal(await wallet(), start + 25);
  await call("POST", `/admin/whatsapp/customers/${alice._id}/wallet`, adminToken, { amount: -5, reason: "Correction" });
  assert.equal(await wallet(), start + 20);
  const txns = await require("../src/models/whatsappTransactionModel").find({ userId: alice._id, mode: "ADMIN" }).lean();
  assert.equal(txns.length, 2);

  assert.equal((await call("POST", `/admin/whatsapp/customers/${alice._id}/credits`, adminToken, { category: "MARKETING", amount: 10, reason: "x" })).status, 409);
  const grant = await call("POST", `/admin/whatsapp/customers/${alice._id}/plan`, adminToken, { planId: String(plan._id), days: 15, reason: "Trial" });
  assert.equal(grant.status, 200, grant.text);
  const credits = await call("POST", `/admin/whatsapp/customers/${alice._id}/credits`, adminToken, { category: "MARKETING", amount: 50, reason: "Bonus" });
  assert.equal(credits.body.data.credits, 550);
  const extend = await call("POST", `/admin/whatsapp/customers/${alice._id}/plan/extend`, adminToken, { days: 10 });
  assert.equal(extend.status, 200);
  const full = await call("GET", `/admin/whatsapp/customers/${alice._id}`, adminToken);
  assert.equal(full.body.data.subscription.plan, "Growth");
  assert.equal(full.body.data.subscription.credits.MARKETING, 550);
  assert.ok(new Date(full.body.data.subscription.endDate) > new Date(Date.now() + 24 * 86400000));

  const audit = await call("GET", `/admin/whatsapp/audit?userId=${alice._id}`, adminToken);
  assert.deepEqual(audit.body.data.rows.map((r) => r.action).sort(), ["credits.adjust", "plan.extend", "plan.grant", "wallet.credit", "wallet.debit"]);
  assert.equal(audit.body.data.rows[0].admin, "Root");
});

test("a feature switched off for everyone is hidden and refused, unless one customer is allowed", { skip }, async () => {
  const saved = await call("PUT", "/admin/whatsapp/panel", adminToken, { features: { campaigns: { enabled: false, message: "Campaigns are paused for maintenance" } } });
  assert.equal(saved.status, 200, saved.text);
  const cfg = await call("GET", "/whatsapp/panel-config", aliceToken);
  assert.equal(cfg.body.data.features.campaigns.enabled, false);
  assert.equal(cfg.body.data.paths["/campaigns"], "campaigns");

  const blocked = await call("POST", "/whatsapp/campaigns", aliceToken, { name: "x" });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "FEATURE_DISABLED");
  assert.equal(blocked.body.message, "Campaigns are paused for maintenance");
  assert.notEqual((await call("GET", "/whatsapp/campaigns", aliceToken)).status, 403, "reading old campaigns still works");
  assert.notEqual((await call("POST", "/whatsapp/campaigns", adminToken, {})).body?.code, "FEATURE_DISABLED", "admins are never blocked");

  const allow = await call("PUT", `/admin/whatsapp/customers/${alice._id}/controls`, adminToken, { features: { campaigns: true } });
  assert.equal(allow.status, 200, allow.text);
  assert.equal(allow.body.data.effective.campaigns.source, "customer");
  assert.notEqual((await call("POST", "/whatsapp/campaigns", aliceToken, { name: "x" })).body?.code, "FEATURE_DISABLED");
  assert.equal((await call("POST", "/whatsapp/campaigns", bobToken, { name: "x" })).body.code, "FEATURE_DISABLED");

  await call("PUT", `/admin/whatsapp/customers/${alice._id}/controls`, adminToken, { features: { campaigns: null } });
  await call("PUT", "/admin/whatsapp/panel", adminToken, { features: { campaigns: { enabled: true } } });
  assert.notEqual((await call("POST", "/whatsapp/campaigns", bobToken, { name: "x" })).body?.code, "FEATURE_DISABLED");
  assert.equal((await call("PUT", `/admin/whatsapp/customers/${alice._id}/controls`, adminToken, { features: { nope: false } })).status, 400);
});

test("switching off the Developer API stops keys at once", { skip }, async () => {
  const v1 = () => h.call("GET", "/api/v1/account", { headers: { authorization: `Bearer ${apiSecret}` } });
  assert.equal((await v1()).status, 200);
  await call("PUT", `/admin/whatsapp/customers/${alice._id}/controls`, adminToken, { features: { api: false } });
  const off = await v1();
  assert.equal(off.status, 403);
  assert.equal(off.body.code, "FEATURE_DISABLED");
  assert.equal((await call("GET", "/whatsapp/developer/keys", aliceToken)).status, 403, "the keys page is refused too");
  await call("PUT", `/admin/whatsapp/customers/${alice._id}/controls`, adminToken, { features: { api: null } });
  assert.equal((await v1()).status, 200);
});

test("a suspended customer can only see why, pay and ask for help", { skip }, async () => {
  assert.equal((await call("PUT", `/admin/whatsapp/customers/${alice._id}/controls`, adminToken, { suspended: true })).status, 400);
  const s = await call("PUT", `/admin/whatsapp/customers/${alice._id}/controls`, adminToken, { suspended: true, suspendReason: "Payment overdue" });
  assert.equal(s.status, 200, s.text);
  const cfg = await call("GET", "/whatsapp/panel-config", aliceToken);
  assert.equal(cfg.body.data.suspended, true);
  assert.equal(cfg.body.data.suspendReason, "Payment overdue");
  const contacts = await call("GET", "/whatsapp/contacts", aliceToken);
  assert.equal(contacts.status, 423);
  assert.equal(contacts.body.code, "ACCOUNT_SUSPENDED");
  assert.equal((await call("GET", "/whatsapp/wallet/balance", aliceToken)).status, 200);
  assert.equal((await h.call("GET", "/api/v1/account", { headers: { authorization: `Bearer ${apiSecret}` } })).status, 423);
  assert.equal((await call("GET", "/whatsapp/contacts", bobToken)).status, 200);
  const list = await call("GET", "/admin/whatsapp/customers?status=suspended", adminToken);
  assert.equal(list.body.data.total, 1);
  await call("PUT", `/admin/whatsapp/customers/${alice._id}/controls`, adminToken, { suspended: false });
  assert.equal((await call("GET", "/whatsapp/contacts", aliceToken)).status, 200);
  const audit = await call("GET", `/admin/whatsapp/audit?userId=${alice._id}&action=account.`, adminToken);
  assert.deepEqual(audit.body.data.rows.map((r) => r.action), ["account.unsuspend", "account.suspend"]);
});

test("announcement and menu are validated and only shown while live", { skip }, async () => {
  assert.equal((await call("PUT", "/admin/whatsapp/panel", adminToken, { announcement: { enabled: true } })).status, 400);
  assert.equal((await call("PUT", "/admin/whatsapp/panel", adminToken, { announcement: { enabled: true, title: "x", linkUrl: "javascript:alert(1)" } })).status, 400);
  assert.equal((await call("PUT", "/admin/whatsapp/panel", adminToken, { menu: { hidden: ["/settings"] } })).status, 400);
  const later = new Date(Date.now() + 3600000).toISOString();
  await call("PUT", "/admin/whatsapp/panel", adminToken, { announcement: { enabled: true, tone: "warning", title: "Maintenance tonight", startsAt: later } });
  assert.equal((await call("GET", "/whatsapp/panel-config", aliceToken)).body.data.announcement, null);
  await call("PUT", "/admin/whatsapp/panel", adminToken, { announcement: { enabled: true, tone: "warning", title: "Maintenance tonight", text: "11pm–1am", linkUrl: "https://marketingkart.in/status" }, menu: { hidden: ["/meta-ads", "/bogus"], labels: { "/chat": "Live Chat" } } });
  const cfg = (await call("GET", "/whatsapp/panel-config", aliceToken)).body.data;
  assert.equal(cfg.announcement.title, "Maintenance tonight");
  assert.equal(cfg.announcement.tone, "warning");
  assert.deepEqual(cfg.menu.hidden, ["/meta-ads"]);
  assert.equal(cfg.menu.labels["/chat"], "Live Chat");
  const settings = await call("GET", "/admin/whatsapp/panel", adminToken);
  assert.ok(settings.body.data.catalog.find((f) => f.key === "campaigns").guarded);
});

test("monitoring lists messages, numbers, API keys, and an admin can revoke a key", { skip }, async () => {
  const failed = await call("GET", "/admin/whatsapp/messages?status=FAILED&withErrors=1", adminToken);
  assert.equal(failed.status, 200, failed.text);
  assert.equal(failed.body.data.total, 1);
  assert.equal(failed.body.data.rows[0].user.name, "Alice Traders");
  assert.equal(failed.body.data.topErrors[0].message, "Message undeliverable");
  const nums = await call("GET", "/admin/whatsapp/numbers?quality=YELLOW", adminToken);
  assert.equal(nums.body.data.rows[0].sent7d, 2);
  assert.ok(!nums.text.includes("meta-secret-token"));
  const keys = await call("GET", "/admin/whatsapp/api", adminToken);
  assert.equal(keys.body.data.total, 1);
  assert.equal(keys.body.data.perDay.length, 14);
  const keyId = keys.body.data.rows[0].id;
  assert.equal((await call("POST", `/admin/whatsapp/customers/${admin._id}/keys/${keyId}/revoke`, adminToken)).status, 404, "key must belong to that customer");
  assert.equal((await call("POST", `/admin/whatsapp/customers/${alice._id}/keys/${keyId}/revoke`, adminToken)).status, 200);
  assert.equal((await h.call("GET", "/api/v1/account", { headers: { authorization: `Bearer ${apiSecret}` } })).status, 401);
  assert.equal((await call("GET", "/admin/whatsapp/integrations", adminToken)).status, 200);
});
