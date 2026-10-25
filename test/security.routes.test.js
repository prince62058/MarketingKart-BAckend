// Route protection, run against the real app and a throwaway mongod: every route that used to be
// reachable without logging in must now turn an anonymous caller away, admin-only routes must also
// turn away an ordinary customer and still work for an admin, and the routes the apps legitimately
// call anonymously (login, public content, the public forms) must stay open.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;
let customerToken;
let adminToken;
let staffToken;
const someId = "64b000000000000000000001";

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness({ replSet: true });
  // MongoDB cannot create a collection from inside a transaction, so create the ones the wallet and
  // staff code write to up front (in production they exist already).
  for (const name of ["Staff", "userModel", "transtionModel"]) {
    const model = require("mongoose").models[name] || null;
    if (model) await model.createCollection();
  }
  const customer = await fixtures.makeUser();
  customerToken = fixtures.tokenFor(customer);
  adminToken = fixtures.tokenFor(await fixtures.makeAdmin());

  const limited = await fixtures.makeAdmin();
  await require("../src/models/staffModel").create({ userId: limited._id, role: "BDE", permissions: ["USERS"] });
  staffToken = fixtures.tokenFor(limited);
});

after(async () => {
  if (h) await h.close();
});

// [method, path, body?]. Admin-only: a customer is refused as well.
const ADMIN_ONLY = [
  ["GET", "/api/staff"],
  ["GET", `/api/staff/${someId}`],
  ["POST", "/api/staff", { name: "Temp", email: "temp.staff@example.test", mobile: 9876500001, permissions: ["USERS"] }],
  ["PUT", `/api/staff/${someId}`, { permissions: [] }],
  ["DELETE", `/api/staff/${someId}`],
  ["GET", `/api/staff/${someId}/businesses`],
  ["POST", "/api/user/CreateAdminSubAdmin", { name: "A", email: "sub.admin@example.test", password: "Pass@123" }],
  ["GET", "/api/user/getAllUsersWithBusiness"],
  ["GET", "/api/user/getAllSubUser"],
  ["GET", "/api/user/getAllUser"],
  ["PUT", "/api/user/CreateSubUser", {}],
  ["PUT", `/api/user/disableUser/${someId}`, {}],
  ["GET", `/api/user/getByIdUserForAdmin/${someId}`],
  ["POST", "/api/createOrUpdateCompany", {}],
  ["POST", "/api/updateCompany", {}],
  ["PUT", "/api/company", {}],
  ["PUT", "/api/updateAppVersion", {}],
  ["POST", "/api/send-to-all-users", {}],
  ["POST", "/api/sendNotificationToSingleUserAndBusiness", {}],
  ["POST", "/api/send-to-business-users", {}],
  ["POST", "/api/send-to-all-users-with-condition", {}],
  ["POST", "/api/createPackage", {}],
  ["PUT", `/api/packages/${someId}`, {}],
  ["DELETE", `/api/deletePackage/${someId}`],
  ["GET", "/api/getInvoiceByBusinessIdByAdmin?userId=" + someId],
  ["GET", "/api/getInvoiceByBusinessIdByAdmins"],
  ["POST", "/api/createInvoice", {}],
  ["PUT", `/api/updateInvoice/${someId}`, {}],
  ["DELETE", `/api/deleteInvoice/${someId}`],
  ["GET", "/api/getOrderHistoriesAdmin"],
  ["POST", "/api/createOrderHistory", {}],
  ["PUT", `/api/updateOrderHistory?orderId=${someId}`, {}],
  ["DELETE", `/api/deleteOrderHistory?orderId=${someId}`],
  ["GET", "/api/listOfGstOfUser"],
  ["GET", "/api/getAllContactUs"],
  ["DELETE", `/api/deleteContactUs/${someId}`],
  ["PUT", `/api/updateContactStatus/${someId}`, {}],
  ["PUT", `/api/updateContactUs/${someId}`, {}],
  ["GET", "/api/getAllGoogleAdsInquiry"],
  ["GET", "/api/googleAdsInquiries"],
  ["PUT", `/api/updateGoogleAdsInquiry/${someId}`, {}],
  ["DELETE", `/api/deleteGoogleAdsInquiry/${someId}`],
  ["POST", "/api/premium-plan/create", {}],
  ["PUT", `/api/premium-plan/update/${someId}`, {}],
  ["DELETE", `/api/premium-plan/delete/${someId}`],
  ["POST", "/api/createsimpleVideo", {}],
  ["PUT", "/api/updatesimpleVideo", {}],
  ["DELETE", "/api/deleteusimpleVideo", undefined],
  ["POST", "/api/createugc", {}],
  ["PUT", "/api/updateugc", {}],
  ["DELETE", "/api/deleteugc", undefined],
  ["POST", "/api/createVoiceOverVideo", {}],
  ["PUT", "/api/updateVoiceOverVideo", {}],
  ["DELETE", "/api/deleteVoiceOverVideo", undefined],
  ["POST", "/api/createVideo", {}],
  ["PUT", "/api/updateVideo", {}],
  ["DELETE", "/api/deleteVideo", undefined],
];

// Any signed-in account may call these (the controller then limits them to their own data).
const SIGNED_IN = [
  ["PUT", `/api/user/updateProfile/${someId}`, { name: "x" }],
  ["POST", "/api/ai", {}],
  ["POST", "/api/imageVideoUpload"],
  ["POST", "/api/PhonePayGateway", {}],
  ["POST", "/api/PhonePayGatewayStatus", {}],
  ["GET", "/api/PhonePayGatewayCheckStatus"],
  ["PUT", "/api/business/unLinkPage", { businessId: someId }],
  ["POST", "/api/business/unLinkPage", { businessId: someId }],
  ["POST", `/api/createCall/${someId}`, {}],
  ["GET", "/api/get-notifications"],
  ["GET", "/api/unread-count"],
  ["PUT", "/api/mark-as-read", {}],
  ["DELETE", "/api/clear-notifications"],
  ["GET", "/api/getInvoiceByBusinessId"],
  ["GET", `/api/getInvoiceDetails/${someId}`],
  ["GET", "/api/getOrderHistories"],
  ["GET", `/api/getOrderHistoryById?orderId=${someId}`],
  ["POST", "/api/createGstOfUser", {}],
  ["GET", `/api/getGstOfUseById?gstNumberId=${someId}`],
  ["GET", "/api/getGstOfUserByUserId"],
  ["PUT", `/api/updateGstOfUser?gstNumberId=${someId}`, {}],
];

// Routes the apps and the public use without an account. They must NOT ask for a login.
const PUBLIC = [
  ["POST", "/api/createContactUs", { name: "Visitor", email: "v@example.test", phone: "9999999999", message: "hello" }],
  ["POST", "/api/googleAdsInquiry", {}],
  ["POST", "/api/createGoogleAdsInquiry", {}],
  ["GET", "/api/getCompany"],
  ["GET", "/api/company"],
  ["GET", "/api/getNewCompany"],
  ["GET", "/api/getAllPackages"],
  ["GET", `/api/packages/${someId}`],
  ["GET", "/api/premium-plan/all"],
  ["GET", "/api/getVideos"],
  ["GET", "/api/getsimpleVideo"],
  ["GET", "/api/getAllsimpleVideo"],
  ["GET", "/api/getugc"],
  ["GET", "/api/getAllugc"],
  ["GET", "/api/getVoiceOverVideo"],
  ["GET", "/api/getAllVoiceOverVideos"],
  ["GET", "/api/getInvoiceHTML?invoiceId=" + someId],
  ["POST", "/api/user/mobileLogIn", {}],
  ["POST", "/api/user/V2/mobileLogInV2", {}],
  ["POST", "/api/user/V2/verifyMobileOtpV2", {}],
  ["POST", "/api/user/adminLogIn", {}],
  ["POST", "/api/user/verifyAdminEmailOtp", {}],
  ["GET", "/api/whatsapp/webhook"],
];

const call = (entry, token) => h.call(entry[0], entry[1], { token, body: entry[2] });
const refused = status => status === 401 || status === 403;

test("every admin-only route turns an anonymous caller away", { skip }, async () => {
  for (const entry of ADMIN_ONLY) {
    const res = await call(entry);
    assert.equal(res.status, 401, `${entry[0]} ${entry[1]} answered ${res.status} without a login`);
  }
});

test("every admin-only route turns an ordinary customer away", { skip }, async () => {
  for (const entry of ADMIN_ONLY) {
    const res = await call(entry, customerToken);
    assert.ok(refused(res.status), `${entry[0]} ${entry[1]} answered ${res.status} for a customer`);
  }
});

test("every admin-only route still reaches its controller for an admin", { skip }, async () => {
  for (const entry of ADMIN_ONLY) {
    const res = await call(entry, adminToken);
    assert.ok(!refused(res.status), `${entry[0]} ${entry[1]} answered ${res.status} for an admin`);
  }
});

test("signed-in routes turn an anonymous caller away and let a customer through to the controller", { skip }, async () => {
  for (const entry of SIGNED_IN) {
    // PhonePayGatewayStatus starts a poll against PhonePe, so only the anonymous refusal is exercised for it.
    const anonymous = await call(entry);
    assert.equal(anonymous.status, 401, `${entry[0]} ${entry[1]} answered ${anonymous.status} without a login`);
    if (entry[1].includes("PhonePayGatewayStatus")) continue;
    const signedIn = await call(entry, customerToken);
    assert.ok(![401].includes(signedIn.status), `${entry[0]} ${entry[1]} answered ${signedIn.status} for a customer`);
  }
});

test("public routes stay open to anonymous callers", { skip }, async () => {
  for (const entry of PUBLIC) {
    const res = await call(entry);
    // 401 is "log in first". Other refusals are the endpoint's own (e.g. Meta's webhook handshake answers 403
    // to a caller without its verify token), which is exactly what a public endpoint should do.
    assert.notEqual(res.status, 401, `${entry[0]} ${entry[1]} asked for a login; it must stay public`);
  }
  const posted = await call(PUBLIC[0]);
  assert.equal(posted.status, 201, "the public contact form still saves");
});

test("staff routes: a staff member limited to USERS can read staff but not create or change them", { skip }, async () => {
  const list = await h.call("GET", "/api/staff", { token: staffToken });
  assert.ok(!refused(list.status), "reading the staff list stays open to every admin");

  const create = await h.call("POST", "/api/staff", {
    token: staffToken,
    body: { name: "Escalation", email: "escalation@example.test", mobile: 9876500002, permissions: ["ALL"] },
  });
  assert.equal(create.status, 403);
  assert.equal(await require("../src/models/userModel").countDocuments({ email: "escalation@example.test" }), 0);

  assert.equal((await h.call("DELETE", `/api/staff/${someId}`, { token: staffToken })).status, 403);

  // Minting an admin account is the same escalation by another route.
  const mint = await h.call("POST", "/api/user/CreateAdminSubAdmin", {
    token: staffToken,
    body: { name: "Mint", email: "mint.admin@example.test", password: "Pass@123" },
  });
  assert.equal(mint.status, 403);
  assert.equal(await require("../src/models/userModel").countDocuments({ email: "mint.admin@example.test" }), 0);

  const created = await h.call("POST", "/api/staff", {
    token: adminToken,
    body: { name: "Real Staff", email: "real.staff@example.test", mobile: 9876500003, permissions: ["USERS"] },
  });
  assert.equal(created.status, 201, created.text);
});

test("company settings need the COMPANY permission; reading them does not", { skip }, async () => {
  const blocked = await h.call("PUT", "/api/toggleMaintenance", { token: staffToken });
  assert.equal(blocked.status, 403);
  const maintenanceOn = await h.call("PUT", "/api/toggleMaintenance", { token: adminToken });
  assert.ok(!refused(maintenanceOn.status));
  // Put it back, or later requests would be answered with the maintenance page.
  await h.call("PUT", "/api/toggleMaintenance", { token: adminToken });
  assert.equal((await h.call("GET", "/api/getCompany")).status === 401, false);
});

test("video routes: /createVideo is answered by the first mounted router, and both are protected", { skip }, async () => {
  const Video = require("../src/models/videoModel");
  const before = await Video.countDocuments();
  const anonymous = await h.call("POST", "/api/createVideo", { body: { title: "x", url: "https://example.test" } });
  assert.equal(anonymous.status, 401);
  assert.equal(await Video.countDocuments(), before, "nothing was written");
});
