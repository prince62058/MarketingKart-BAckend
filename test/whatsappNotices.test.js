// Super admin → customer notifications: who may send, who receives them, the customer's bell
// (unread, read, read all), withdrawal, and the audit trail.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let f;
let adminToken;
let staffToken;
let connected;
let connectedToken;
let noNumber;
let noNumberToken;
let disabled;
let outsiderToken;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  f = require("./helpers/securityFixtures");
  adminToken = f.tokenFor(await f.makeAdmin({ name: "Root" }));
  const limited = await f.makeAdmin({ name: "Plans only" });
  await require("../src/models/staffModel").create({ userId: limited._id, role: "STAFF", permissions: ["WA_PLANS"], isActive: true, businesses: [] });
  staffToken = f.tokenFor(limited);
  const Account = require("../src/models/whatsappAccountModel");
  connected = await f.makeUser({ name: "Connected Co", fcm: "device-token-1" });
  connectedToken = f.tokenFor(connected);
  await Account.create({ userId: connected._id, phoneNumberId: "pn-n1", wabaId: "w1", phoneNumber: "+91 90000 33001", status: "CONNECTED", qualityRating: "GREEN", accessToken: "x" });
  noNumber = await f.makeUser({ name: "Wallet Only", whatsappWallet: 50 });
  noNumberToken = f.tokenFor(noNumber);
  disabled = await f.makeUser({ name: "Disabled Co", disable: true });
  await Account.create({ userId: disabled._id, phoneNumberId: "pn-n2", wabaId: "w2", phoneNumber: "+91 90000 33002", status: "CONNECTED", accessToken: "x" });
  outsiderToken = f.tokenFor(await f.makeUser({ name: "Not a WhatsApp customer" }));
});

after(async () => {
  if (h) await h.close();
});

const call = (method, route, token, body) => h.call(method, `/api${route}`, { token, body });
const note = (extra = {}) => ({ title: "Maintenance tonight", body: "Campaigns pause 1–2 am IST.", tone: "warning", ...extra });

test("only admins with WA_ADMIN can send or see notifications", { skip }, async () => {
  assert.equal((await call("POST", "/admin/whatsapp/notifications", null, note({ audience: { type: "all" } }))).status, 401);
  assert.equal((await call("POST", "/admin/whatsapp/notifications", connectedToken, note({ audience: { type: "all" } }))).status, 401);
  assert.equal((await call("POST", "/admin/whatsapp/notifications", staffToken, note({ audience: { type: "all" } }))).status, 403);
  assert.equal((await call("GET", "/admin/whatsapp/notifications", staffToken)).status, 403);
});

test("bad input is refused before anything is sent", { skip }, async () => {
  assert.equal((await call("POST", "/admin/whatsapp/notifications", adminToken, { body: "x", audience: { type: "all" } })).status, 400);
  assert.equal((await call("POST", "/admin/whatsapp/notifications", adminToken, note({ audience: { type: "segment", segment: "nope" } }))).status, 400);
  assert.equal((await call("POST", "/admin/whatsapp/notifications", adminToken, note({ audience: { type: "customers", userIds: [] } }))).status, 400);
  assert.equal((await call("POST", "/admin/whatsapp/notifications", adminToken, note({ link: { url: "javascript:alert(1)" }, audience: { type: "all" } }))).status, 400);
  const { Notice } = require("../src/modules/waAdmin/waNotifications");
  assert.equal(await Notice.countDocuments(), 0);
});

test("all customers: every active WhatsApp customer gets it, disabled and non-customers do not", { skip }, async () => {
  const pre = await call("POST", "/admin/whatsapp/notifications/preview", adminToken, { audience: { type: "all" } });
  assert.equal(pre.status, 200, pre.text);
  assert.equal(pre.body.data.count, 2);
  assert.equal(pre.body.data.withApp, 1);

  const sent = await call("POST", "/admin/whatsapp/notifications", adminToken, note({ audience: { type: "all" }, link: { url: "https://status.example.com", label: "Status" } }));
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.body.data.recipients, 2);

  const mine = await call("GET", "/whatsapp/notifications", connectedToken);
  assert.equal(mine.body.data.unread, 1);
  assert.equal(mine.body.data.rows[0].title, "Maintenance tonight");
  assert.equal(mine.body.data.rows[0].tone, "warning");
  assert.equal(mine.body.data.rows[0].link.url, "https://status.example.com");
  assert.equal((await call("GET", "/whatsapp/notifications/unread-count", noNumberToken)).body.data.unread, 1);
  assert.equal((await call("GET", "/whatsapp/notifications", outsiderToken)).body.data.total, 0);
  const { Receipt } = require("../src/modules/waAdmin/waNotifications");
  assert.equal(await Receipt.countDocuments({ userId: disabled._id }), 0, "a disabled account is skipped");
});

test("a segment reaches only that group; picked customers only those people", { skip }, async () => {
  const seg = await call("POST", "/admin/whatsapp/notifications", adminToken, note({ title: "Number check", audience: { type: "segment", segment: "no-number" } }));
  assert.equal(seg.status, 200, seg.text);
  assert.equal(seg.body.data.recipients, 1);
  assert.equal((await call("GET", "/whatsapp/notifications", noNumberToken)).body.data.rows[0].title, "Number check");
  assert.ok(!(await call("GET", "/whatsapp/notifications", connectedToken)).body.data.rows.some((r) => r.title === "Number check"));

  const picked = await call("POST", "/admin/whatsapp/notifications", adminToken, note({ title: "Just for you", tone: "success", audience: { type: "customers", userIds: [String(connected._id)] } }));
  assert.equal(picked.body.data.recipients, 1);
  assert.equal(picked.body.data.audience.label, "1 picked customer");
  assert.equal((await call("GET", "/whatsapp/notifications", connectedToken)).body.data.rows[0].title, "Just for you");
});

test("the bell: read one, read all, and nobody can read someone else's", { skip }, async () => {
  const before = (await call("GET", "/whatsapp/notifications", connectedToken)).body.data;
  assert.ok(before.unread >= 2);
  const first = before.rows[0];
  const one = await call("POST", `/whatsapp/notifications/${first.id}/read`, connectedToken);
  assert.equal(one.status, 200);
  assert.equal(one.body.data.unread, before.unread - 1);

  const segNotice = (await call("GET", "/whatsapp/notifications", noNumberToken)).body.data.rows.find((r) => r.title === "Number check");
  assert.equal((await call("POST", `/whatsapp/notifications/${segNotice.id}/read`, connectedToken)).status, 404);

  assert.equal((await call("POST", "/whatsapp/notifications/read-all", connectedToken)).body.data.unread, 0);
  assert.equal((await call("GET", "/whatsapp/notifications/unread-count", connectedToken)).body.data.unread, 0);
});

test("history shows reach and reads; withdrawing hides it from customers; all of it is audited", { skip }, async () => {
  const list = await call("GET", "/admin/whatsapp/notifications", adminToken);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.total, 3);
  const all = list.body.data.rows.find((r) => r.audience.type === "all");
  assert.equal(all.recipients, 2);
  assert.equal(all.read, 1, "the connected customer read it via read-all");
  assert.equal(all.channels.app, false);

  const gone = await call("POST", `/admin/whatsapp/notifications/${all.id}/withdraw`, adminToken);
  assert.equal(gone.status, 200);
  assert.ok(gone.body.data.withdrawnAt);
  const after = (await call("GET", "/whatsapp/notifications", noNumberToken)).body.data;
  assert.ok(!after.rows.some((r) => r.id === all.id));

  const audit = await call("GET", "/admin/whatsapp/audit?action=notification", adminToken);
  assert.deepEqual(audit.body.data.rows.map((r) => r.action).sort(), ["notification.send", "notification.send", "notification.send", "notification.withdraw"]);
});

test("with the app channel it is also listed in the mobile app's notifications", { skip }, async () => {
  const sent = await call("POST", "/admin/whatsapp/notifications", adminToken, note({ title: "App too", channels: { app: true }, audience: { type: "customers", userIds: [String(connected._id), String(noNumber._id)] } }));
  assert.equal(sent.status, 200, sent.text);
  const AppNotification = require("../src/models/notificationModel");
  let rows = [];
  for (let i = 0; i < 20 && rows.length < 2; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    rows = await AppNotification.find({ title: "App too" }).lean();
  }
  assert.equal(rows.length, 2);
  assert.equal(rows[0].metadata.type, "WhatsAppNotice");
  const { Notice } = require("../src/modules/waAdmin/waNotifications");
  let doc;
  for (let i = 0; i < 20; i += 1) { doc = await Notice.findById(sent.body.data.id).lean(); if (doc.push.done) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(doc.push.done, true);
  assert.equal(doc.push.noDevice, 1);
});
