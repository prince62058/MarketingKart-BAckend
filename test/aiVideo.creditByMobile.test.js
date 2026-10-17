// An admin credits AI video balance by the customer's phone number. Throwaway local mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootHarness } = require("./helpers/aiVideoHarness");

let h;
let Studio;
let User;
let Audit;
let admin;
let settings;
const opts = { skip: !hasMongod && "mongod is not installed" };
const actor = { _id: "64b0000000000000000000aa", name: "Admin One" };

before(async () => {
  if (!hasMongod) return;
  h = await bootHarness();
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  User = require("../src/models/userModel");
  admin = require("../src/modules/aiVideo/aiVideo.admin.service");
  settings = require("../src/modules/aiVideo/aiVideo.settings");
  ({ Audit } = require("../src/modules/aiVideo/aiVideo.settings.model"));
  await Promise.all([Studio.init(), User.init()]);
});

after(async () => {
  if (h) await h.close();
});

const credit = (mobile, amount, extra = {}) => admin.adjustCreditsByMobile({ admin: actor, mobile, amount, reason: "Goodwill credit", ...extra });
const rejects = (promise, status, pattern) =>
  assert.rejects(promise, error => {
    assert.equal(error.status, status, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });

test("a customer who never opened AI Video is credited by number on top of the free credits", opts, async () => {
  await User.create({ name: "Newcomer", mobile: 9811100001 });
  const free = (await settings.get()).freeCredits;
  const result = await credit("9811100001", 250);
  assert.equal(result.credits, free + 250);
  assert.deepEqual({ name: result.user.name, mobile: result.user.mobile }, { name: "Newcomer", mobile: 9811100001 });
  assert.equal(await Studio.countDocuments({ userId: result.user.id }), 1);
});

test("the number can be typed with spaces, +91 or a leading 0", opts, async () => {
  await User.create({ name: "Formats", mobile: 9811100002 });
  const free = (await settings.get()).freeCredits;
  let total = free;
  for (const typed of ["+91 98111 00002", "09811100002", "919811100002", " 98111-00002 "]) {
    total += 10;
    assert.equal((await credit(typed, 10)).credits, total, typed);
  }
});

test("a customer with one business is credited on that business's studio, where the app will look", opts, async () => {
  const Business = require("../src/models/businessModel");
  const user = await User.create({ name: "One Shop", mobile: 9811100003 });
  const shop = await Business.create({ businessName: "Corner Shop", userId: user._id });
  const result = await credit("9811100003", 40);
  assert.equal(result.businessId, String(shop._id));
  assert.equal(result.businessName, "Corner Shop");
  assert.equal((await Studio.findOne({ userId: user._id, businessId: String(shop._id) })).credits, result.credits);
});

test("a customer with several businesses must say which one", opts, async () => {
  const Business = require("../src/models/businessModel");
  const user = await User.create({ name: "Two Shops", mobile: 9811100004 });
  const [first, second] = await Business.create([
    { businessName: "North Branch", userId: user._id },
    { businessName: "South Branch", userId: user._id },
  ]);
  await rejects(credit("9811100004", 10), 409, /North Branch.*South Branch|South Branch.*North Branch/);
  assert.equal(await Studio.countDocuments({ userId: user._id }), 0, "nothing is created until a business is chosen");

  const chosen = await credit("9811100004", 10, { businessId: String(second._id) });
  assert.equal(chosen.businessName, "South Branch");
  assert.equal(await Studio.countDocuments({ userId: user._id, businessId: String(first._id) }), 0);
  await rejects(credit("9811100004", 10, { businessId: "64b0000000000000000000ee" }), 400, /does not belong/);
});

test("unknown or malformed numbers are refused and nothing is created", opts, async () => {
  const before = await Studio.countDocuments();
  await rejects(credit("9000000000", 10), 404, /No customer/);
  for (const bad of ["", "12345", "abcdefghij", null, undefined]) await rejects(credit(bad, 10), 400, /10 digit/);
  assert.equal(await Studio.countDocuments(), before);
});

test("the same rules apply as the studio screen: a reason, whole numbers, never below zero, audited", opts, async () => {
  await User.create({ name: "Rules", mobile: 9811100005 });
  await rejects(admin.adjustCreditsByMobile({ admin: actor, mobile: "9811100005", amount: 10 }), 400, /reason/i);
  for (const amount of [0, 2.5, "many", 100001]) await rejects(credit("9811100005", amount), 400);

  const free = (await settings.get()).freeCredits;
  assert.equal((await credit("9811100005", -free)).credits, 0);
  await rejects(credit("9811100005", -1), 400, /more credits than/);

  const user = await User.findOne({ mobile: 9811100005 });
  const entries = await Audit.find({ action: "credits.adjust", userId: String(user._id) }).sort({ createdAt: 1 }).lean();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].adminName, "Admin One");
  assert.equal(entries[0].data.amount, -free);
});
