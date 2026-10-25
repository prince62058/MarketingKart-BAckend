// A signed-in customer can reach only their own data. Run against the real app and a throwaway mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;
let alice;
let bob;
let admin;
let aliceToken;
let bobToken;
let adminToken;
let User;
let Business;
let Notification;
let Invoice;
let OrderHistory;
let Gst;
let CallRequest;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  User = require("../src/models/userModel");
  Business = require("../src/models/businessModel");
  Notification = require("../src/models/notificationModel");
  Invoice = require("../src/models/invoiceModel");
  OrderHistory = require("../src/models/orderHistoryModel");
  Gst = require("../src/models/GstOfUserModel");
  CallRequest = require("../src/models/callRequestModel");
  alice = await fixtures.makeUser({ name: "Alice", email: "alice@example.test" });
  bob = await fixtures.makeUser({ name: "Bob", email: "bob@example.test" });
  admin = await fixtures.makeAdmin();
  [aliceToken, bobToken, adminToken] = [alice, bob, admin].map(user => fixtures.tokenFor(user));
});

after(async () => {
  if (h) await h.close();
});

test("one customer cannot read or change another customer's account", { skip }, async () => {
  const own = await h.call("GET", `/api/user/getByIdUser/${alice._id}`, { token: aliceToken });
  assert.equal(own.status, 200);
  assert.equal(own.body.data.name, "Alice");
  for (const field of ["password", "otp", "otp2", "otpExpiresAt", "otpAttempts"]) assert.equal(own.body.data[field], undefined, `${field} is not sent to the app`);

  const other = await h.call("GET", `/api/user/getByIdUser/${bob._id}`, { token: aliceToken });
  assert.equal(other.status, 403);
  assert.equal(other.body.data, undefined);

  const asAdmin = await h.call("GET", `/api/user/getByIdUser/${bob._id}`, { token: adminToken });
  assert.equal(asAdmin.status, 200);
});

test("updateProfile: owner and admin only; contact details are admin-only", { skip }, async () => {
  const anonymous = await h.call("PUT", `/api/user/updateProfile/${bob._id}`, { body: { name: "Hacked" } });
  assert.equal(anonymous.status, 401);

  const stranger = await h.call("PUT", `/api/user/updateProfile/${bob._id}`, { token: aliceToken, body: { name: "Hacked", email: "evil@example.test" } });
  assert.equal(stranger.status, 403);
  assert.equal((await User.findById(bob._id)).name, "Bob");

  const owner = await h.call("PUT", `/api/user/updateProfile/${alice._id}`, {
    token: aliceToken,
    body: { name: "Alice B", email: "taken-over@example.test", mobile: 9999999999 },
  });
  assert.equal(owner.status, 200);
  const stored = await User.findById(alice._id);
  assert.equal(stored.name, "Alice B", "name is the owner's to change");
  assert.equal(stored.email, "alice@example.test", "login e-mail is not");
  assert.equal(stored.mobile, alice.mobile, "login mobile is not");

  const byAdmin = await h.call("PUT", `/api/user/updateProfile/${bob._id}`, { token: adminToken, body: { email: "bob.new@example.test" } });
  assert.equal(byAdmin.status, 200);
  assert.equal((await User.findById(bob._id)).email, "bob.new@example.test");
});

test("disableUser: admins only, and a customer cannot switch someone else off", { skip }, async () => {
  const stranger = await h.call("PUT", `/api/user/disableUser/${bob._id}`, { token: aliceToken, body: { isDisable: true } });
  assert.ok([401, 403].includes(stranger.status));
  assert.equal((await User.findById(bob._id)).disable, false);

  const carol = await fixtures.makeUser();
  const done = await h.call("PUT", `/api/user/disableUser/${carol._id}`, { token: adminToken, body: { isDisable: true } });
  assert.equal(done.status, 200);
  assert.equal((await User.findById(carol._id)).disable, true);
  assert.equal((await h.call("GET", `/api/user/getByIdUser/${carol._id}`, { token: fixtures.tokenFor(carol) })).status, 403);
});

test("notifications: a customer sees, counts, marks and clears only their own", { skip }, async () => {
  await Notification.deleteMany({});
  const [a1, a2, b1] = await Notification.create([
    { title: "A1", userId: alice._id },
    { title: "A2", userId: alice._id },
    { title: "B1", userId: bob._id },
  ]);

  const mine = await h.call("GET", `/api/get-notifications?userId=${bob._id}`, { token: aliceToken });
  assert.deepEqual(mine.body.notifications.map(n => n.title).sort(), ["A1", "A2"], "asking for Bob's gives Alice's own");

  const count = await h.call("GET", `/api/unread-count?userId=${bob._id}`, { token: aliceToken });
  assert.equal(count.body.unreadCount, 2);

  await h.call("PUT", "/api/mark-as-read", { token: aliceToken, body: { notificationId: String(b1._id) } });
  assert.equal((await Notification.findById(b1._id)).read, false, "cannot mark Bob's notification");
  await h.call("PUT", "/api/mark-as-read", { token: aliceToken, body: { all: true, userId: String(bob._id) } });
  assert.equal((await Notification.findById(b1._id)).read, false, "'all' means all of her own");
  assert.equal((await Notification.findById(a1._id)).read, true);

  await h.call("DELETE", "/api/clear-notifications", { token: aliceToken, body: { userId: String(bob._id) } });
  assert.equal(await Notification.countDocuments({ userId: alice._id }), 0);
  assert.equal(await Notification.countDocuments({ userId: bob._id }), 1, "Bob's are still there");
  assert.ok(a2);

  // The admin panel keeps working: no userId means everyone's.
  const everyone = await h.call("GET", "/api/get-notifications", { token: adminToken });
  assert.equal(everyone.body.notifications.length, 1);
  const cleared = await h.call("DELETE", "/api/clear-notifications", { token: adminToken });
  assert.equal(cleared.status, 200);
  assert.equal(await Notification.countDocuments({}), 0);
});

test("invoices: a customer lists and opens only their own", { skip }, async () => {
  const [mine, theirs] = await Invoice.create([
    { userId: alice._id, invoiceNumber: "A-1", totalAmount: 10 },
    { userId: bob._id, invoiceNumber: "B-1", totalAmount: 20 },
  ]);
  const list = await h.call("GET", `/api/getInvoiceByBusinessId?userId=${bob._id}`, { token: aliceToken });
  assert.deepEqual(list.body.data.map(i => i.invoiceNumber), ["A-1"]);

  assert.equal((await h.call("GET", `/api/getInvoiceDetails/${mine._id}`, { token: aliceToken })).status, 200);
  assert.equal((await h.call("GET", `/api/getInvoiceDetails/${theirs._id}`, { token: aliceToken })).status, 404);
  assert.equal((await h.call("GET", `/api/getInvoiceDetails/${theirs._id}`, { token: adminToken })).status, 200);

  const adminList = await h.call("GET", `/api/getInvoiceByBusinessId?userId=${bob._id}`, { token: adminToken });
  assert.deepEqual(adminList.body.data.map(i => i.invoiceNumber), ["B-1"]);
});

test("order history: a customer lists and opens only their own", { skip }, async () => {
  const [mine, theirs] = await OrderHistory.create([
    { userId: alice._id, type: "UGC" },
    { userId: bob._id, type: "VOICE" },
  ]);
  const list = await h.call("GET", `/api/getOrderHistories?userId=${bob._id}`, { token: aliceToken });
  assert.deepEqual(list.body.data.map(o => o.type), ["UGC"]);
  assert.equal((await h.call("GET", `/api/getOrderHistoryById?orderId=${mine._id}`, { token: aliceToken })).status, 200);
  assert.equal((await h.call("GET", `/api/getOrderHistoryById?orderId=${theirs._id}`, { token: aliceToken })).status, 404);
});

test("GST details: created for the caller, readable and editable only by their owner or an admin", { skip }, async () => {
  const created = await h.call("POST", "/api/createGstOfUser", { token: aliceToken, body: { gstNumber: "29ABCDE1234F1Z5", userId: String(bob._id) } });
  assert.equal(created.status, 201);
  assert.equal(String(created.body.data.userId), String(alice._id), "a customer cannot file GST under someone else");
  const id = created.body.data._id;

  assert.equal((await h.call("GET", `/api/getGstOfUseById?gstNumberId=${id}`, { token: aliceToken })).status, 200);
  assert.equal((await h.call("GET", `/api/getGstOfUseById?gstNumberId=${id}`, { token: bobToken })).status, 404);
  const byUser = await h.call("GET", `/api/getGstOfUserByUserId?userId=${alice._id}`, { token: bobToken });
  assert.equal(byUser.body.data, null, "asking for Alice's returns Bob's (empty) own");

  const hijack = await h.call("PUT", `/api/updateGstOfUser?gstNumberId=${id}`, { token: bobToken, body: { gstNumber: "HIJACKED" } });
  assert.equal(hijack.status, 404);
  assert.equal((await Gst.findById(id)).gstNumber, "29ABCDE1234F1Z5");

  const own = await h.call("PUT", `/api/updateGstOfUser?gstNumberId=${id}`, { token: aliceToken, body: { gstNumber: "29ZZZZZ9999Z1Z9", userId: String(bob._id) } });
  assert.equal(own.status, 200);
  const stored = await Gst.findById(id);
  assert.equal(stored.gstNumber, "29ZZZZZ9999Z1Z9");
  assert.equal(String(stored.userId), String(alice._id), "ownership cannot be moved");
});

test("unLinkPage: only the business owner (or an admin) can wipe the page link", { skip }, async () => {
  const business = await fixtures.makeBusiness(alice, { pageId: "123", pageAccessToken: "secret-token", isFacebookPageLinked: true });

  const anonymous = await h.call("PUT", "/api/business/unLinkPage", { body: { businessId: String(business._id) } });
  assert.equal(anonymous.status, 401);
  const stranger = await h.call("PUT", "/api/business/unLinkPage", { token: bobToken, body: { businessId: String(business._id) } });
  assert.equal(stranger.status, 404);
  assert.equal((await Business.findById(business._id)).pageAccessToken, "secret-token");

  const owner = await h.call("POST", "/api/business/unLinkPage", { token: aliceToken, body: { businessId: String(business._id) } });
  assert.equal(owner.status, 200);
  const stored = await Business.findById(business._id);
  assert.equal(stored.isFacebookPageLinked, false);
  assert.ok(!stored.pageAccessToken);

  const second = await fixtures.makeBusiness(bob, { pageId: "456", pageAccessToken: "other", isFacebookPageLinked: true });
  const byAdmin = await h.call("PUT", "/api/business/unLinkPage", { token: adminToken, body: { businessId: String(second._id) } });
  assert.equal(byAdmin.status, 200);
});

test("call request: a customer can only ask for a call for themselves", { skip }, async () => {
  const forOther = await h.call("POST", `/api/createCall/${bob._id}`, { token: aliceToken, body: {} });
  assert.equal(forOther.status, 403);
  assert.equal(await CallRequest.countDocuments({ userId: bob._id }), 0);
  const forSelf = await h.call("POST", `/api/createCall/${alice._id}`, { token: aliceToken, body: {} });
  assert.ok(![401, 403].includes(forSelf.status), `answered ${forSelf.status}`);
});
