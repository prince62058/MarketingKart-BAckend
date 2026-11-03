// Ad packages (plans) and the Custom Budget rules: only the admin panel may change them, customers read
// them, and what the admin saves is what the app is told. Real app, throwaway local mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;
let customer;
let admin;
let customerToken;
let adminToken;
let objective;
let Plan;
let Staff;
let Settings;

const plan = (extra = {}) => ({ title: "Starter 2 days", price: 500, duretion: 2, advertisementTypeId: String(objective._id), ...extra });
const rules = (extra = {}) => ({
  customEnabled: true,
  minBudget: 1500,
  maxBudget: 200000,
  defaultBudget: 2000,
  budgetPresets: [1500, 2000, 5000, 10000],
  defaultDuration: 4,
  maxDuration: 60,
  durationPresets: [3, 7, 14, 30],
  minDailySpend: 89,
  ...extra,
});

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  Plan = require("../src/models/planModel");
  Staff = require("../src/models/staffModel");
  Settings = require("../src/models/adBudgetSettingsModel");
  const Advertisement = require("../src/models/advertisementModel");
  customer = await fixtures.makeUser({ name: "Customer" });
  admin = await fixtures.makeAdmin();
  [customerToken, adminToken] = [customer, admin].map(user => fixtures.tokenFor(user));
  objective = await Advertisement.create({ title: "Lead On WhatsApp", advertisementType: "WHATSAPP_MESSAGES" });
});

after(async () => {
  if (h) await h.close();
});

test("a customer can read the packages but cannot create, change, disable or delete one", { skip }, async () => {
  const created = await h.call("POST", "/api/plan/createPlan", { token: adminToken, body: plan() });
  assert.equal(created.status, 201);
  const id = created.body.data._id;

  assert.equal((await h.call("GET", "/api/plan/getAllPlan", { token: customerToken })).status, 200);
  for (const [method, route, body] of [
    ["POST", "/api/plan/createPlan", plan({ title: "Free for me", price: 1 })],
    ["PUT", `/api/plan/updatePlan/${id}`, { price: 1 }],
    ["PUT", `/api/plan/disablePlan/${id}`, {}],
    ["DELETE", `/api/plan/deletePlan/${id}`, undefined],
  ]) {
    const refused = await h.call(method, route, { token: customerToken, body });
    assert.equal(refused.status, 401, `${method} ${route}`);
    const anonymous = await h.call(method, route, { body });
    assert.equal(anonymous.status, 401);
  }
  const untouched = await Plan.findById(id).lean();
  assert.equal(untouched.price, 500);
  assert.equal(untouched.disable, false);
  assert.equal(await Plan.countDocuments({ title: "Free for me" }), 0);
});

test("an admin can create, list, edit, switch off and delete packages, and a new one can follow", { skip }, async () => {
  await Plan.deleteMany({});
  const first = await h.call("POST", "/api/plan/createPlan", { token: adminToken, body: plan({ title: "One", price: 1999, duretion: 4, views: "10k - 18k", reach: "9k - 15k", leads: "60 - 110" }) });
  assert.equal(first.status, 201);
  const stored = await Plan.findById(first.body.data._id).lean();
  assert.deepEqual([stored.title, stored.price, stored.duretion, stored.views, stored.reach, stored.leads], ["One", 1999, 4, "10k - 18k", "9k - 15k", "60 - 110"]);
  assert.equal(stored.dailySpendBudget, 500);

  const listed = await h.call("GET", "/api/plan/getAllPlan", { token: customerToken });
  assert.deepEqual(listed.body.data.map(item => item.title), ["One"]);
  assert.equal(listed.body.data[0].advertisementTypeId.title, "Lead On WhatsApp", "the app matches packages to the ad objective by this");

  const edited = await h.call("PUT", `/api/plan/updatePlan/${first.body.data._id}`, { token: adminToken, body: { title: "One (Diwali)", price: 2499 } });
  assert.equal(edited.status, 200);
  assert.deepEqual((await Plan.findById(first.body.data._id).lean()).title, "One (Diwali)");
  assert.equal((await Plan.findById(first.body.data._id).lean()).duretion, 4, "fields not sent are left alone");

  const off = await h.call("PUT", `/api/plan/disablePlan/${first.body.data._id}`, { token: adminToken, body: {} });
  assert.equal(off.status, 200);
  assert.equal((await Plan.findById(first.body.data._id).lean()).disable, true);

  const gone = await h.call("DELETE", `/api/plan/deletePlan/${first.body.data._id}`, { token: adminToken });
  assert.equal(gone.status, 200);
  const empty = await h.call("GET", "/api/plan/getAllPlan", { token: customerToken });
  assert.equal(empty.status, 200, "no packages is an empty list, not an error");
  assert.deepEqual(empty.body.data, []);

  const second = await h.call("POST", "/api/plan/createPlan", { token: adminToken, body: plan({ title: "Two", price: 3999, duretion: 10 }) });
  assert.equal(second.status, 201);
  assert.deepEqual((await h.call("GET", "/api/plan/getAllPlan", { token: customerToken })).body.data.map(item => item.title), ["Two"]);
});

test("a package needs a name, a price, a whole number of days and a real ad objective", { skip }, async () => {
  const before = await Plan.countDocuments();
  for (const [what, body, pattern] of [
    ["no name", plan({ title: "  " }), /name/],
    ["no price", plan({ price: 0 }), /price/],
    ["negative price", plan({ price: -5 }), /price/],
    ["text price", plan({ price: "lots" }), /price/],
    ["no days", plan({ duretion: undefined }), /Duration/],
    ["fractional days", plan({ duretion: 2.5 }), /Duration/],
    ["too many days", plan({ duretion: 400 }), /Duration/],
    ["no objective", plan({ advertisementTypeId: undefined }), /objective/],
    ["made-up objective", plan({ advertisementTypeId: "64b0000000000000000000ee" }), /does not exist/],
    ["junk objective", plan({ advertisementTypeId: "nope" }), /objective/],
    ["negative AI images", plan({ aiImageCount: -1 }), /AI images/],
  ]) {
    const response = await h.call("POST", "/api/plan/createPlan", { token: adminToken, body });
    assert.equal(response.status, 400, what);
    assert.match(response.body.message, pattern, what);
  }
  assert.equal(await Plan.countDocuments(), before);

  const id = (await Plan.findOne())._id;
  const bad = await h.call("PUT", `/api/plan/updatePlan/${id}`, { token: adminToken, body: { price: 0 } });
  assert.equal(bad.status, 400);
});

test("staff may manage packages only with the PLAN permission", { skip }, async () => {
  const staffUser = await fixtures.makeAdmin({ email: "staff-plan@example.test" });
  const token = fixtures.tokenFor(staffUser);
  await Staff.create({ userId: staffUser._id, role: "STAFF", permissions: ["ADS"] });
  const refused = await h.call("POST", "/api/plan/createPlan", { token, body: plan({ title: "Sneaky" }) });
  assert.equal(refused.status, 403);
  assert.equal(await Plan.countDocuments({ title: "Sneaky" }), 0);

  await Staff.updateOne({ userId: staffUser._id }, { permissions: ["ADS", "PLAN"] });
  const allowed = await h.call("POST", "/api/plan/createPlan", { token, body: plan({ title: "Allowed" }) });
  assert.equal(allowed.status, 201);
});

test("customers are told the built-in Custom Budget rules until the admin saves their own", { skip }, async () => {
  await Settings.deleteMany({});
  const response = await h.call("GET", "/api/adBudget/settings", { token: customerToken });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, {
    customEnabled: true,
    minBudget: 1500,
    maxBudget: 1000000,
    defaultBudget: 1500,
    budgetPresets: [1500, 2000, 3000, 5000, 10000],
    defaultDuration: 4,
    maxDuration: 60,
    durationPresets: [1, 3, 5, 7, 14, 30],
    minDailySpend: 89,
  });
  assert.equal((await h.call("GET", "/api/adBudget/settings")).status, 401, "not public");
});

test("what the admin saves is what the app is told next", { skip }, async () => {
  const saved = await h.call("PUT", "/api/adBudget/settings", { token: adminToken, body: rules({ budgetPresets: [10000, 1500, 5000, 2000] }) });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.data.budgetPresets, [1500, 2000, 5000, 10000], "buttons are kept in order");

  const read = await h.call("GET", "/api/adBudget/settings", { token: customerToken });
  assert.deepEqual(read.body.data, { ...rules(), budgetPresets: [1500, 2000, 5000, 10000] });
  assert.equal((await Settings.findOne({ key: "global" }).lean()).updatedBy, admin.name);

  const off = await h.call("PUT", "/api/adBudget/settings", { token: adminToken, body: rules({ customEnabled: false }) });
  assert.equal(off.body.data.customEnabled, false);
  assert.equal((await h.call("GET", "/api/adBudget/settings", { token: customerToken })).body.data.customEnabled, false);
  assert.equal(await Settings.countDocuments(), 1, "one set of rules, saved over");
});

test("customers cannot change the Custom Budget rules, and staff need the PLAN permission", { skip }, async () => {
  const before = await Settings.findOne({ key: "global" }).lean();
  const refused = await h.call("PUT", "/api/adBudget/settings", { token: customerToken, body: rules({ minBudget: 100, defaultBudget: 2000 }) });
  assert.equal(refused.status, 401);
  assert.deepEqual((await Settings.findOne({ key: "global" }).lean()).minBudget, before.minBudget);

  const staffUser = await fixtures.makeAdmin({ email: "staff-budget@example.test" });
  await Staff.create({ userId: staffUser._id, role: "STAFF", permissions: ["LEAD"] });
  const noPermission = await h.call("PUT", "/api/adBudget/settings", { token: fixtures.tokenFor(staffUser), body: rules() });
  assert.equal(noPermission.status, 403);
});

test("rules that contradict each other are refused with a plain reason and nothing is saved", { skip }, async () => {
  const before = JSON.stringify(await Settings.findOne({ key: "global" }).lean());
  for (const [what, body, pattern] of [
    ["max below min", rules({ minBudget: 5000, maxBudget: 2000 }), /maximum budget/],
    ["start outside range", rules({ defaultBudget: 900 }), /Starting budget/],
    ["button outside range", rules({ budgetPresets: [1500, 999999] }), /Budget buttons/],
    ["no buttons", rules({ budgetPresets: [] }), /at least one/],
    ["duplicate buttons", rules({ budgetPresets: [1500, 1500] }), /twice/],
    ["too many buttons", rules({ budgetPresets: [1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300] }), /at most 8/],
    ["fractional budget", rules({ minBudget: 1500.5 }), /whole number/],
    ["text budget", rules({ minBudget: "lots" }), /whole number/],
    ["duration button past the longest", rules({ durationPresets: [3, 90] }), /Duration buttons/],
    ["start duration past the longest", rules({ defaultDuration: 90 }), /Starting duration/],
    ["start below the daily floor", rules({ defaultBudget: 1500, defaultDuration: 30 }), /a day, below the minimum/],
    ["tab switch missing", { ...rules(), customEnabled: "yes" }, /on or off/],
  ]) {
    const response = await h.call("PUT", "/api/adBudget/settings", { token: adminToken, body });
    assert.equal(response.status, 400, what);
    assert.match(response.body.message, pattern, what);
  }
  assert.equal(JSON.stringify(await Settings.findOne({ key: "global" }).lean()), before, "nothing was saved");
});
