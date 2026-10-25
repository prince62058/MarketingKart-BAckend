// The first-start price list: inserted once, never over an admin's own settings. Throwaway mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootHarness } = require("./helpers/aiVideoHarness");

let h;
let seed;
let store;
let models;
let service;
const opts = { skip: !hasMongod && "mongod is not installed" };

before(async () => {
  if (!hasMongod) return;
  h = await bootHarness();
  models = require("../src/modules/aiVideo/aiVideo.settings.model");
  store = require("../src/modules/aiVideo/aiVideo.settings");
  service = require("../src/modules/aiVideo/aiVideo.service");
  seed = require("../src/startup/seedAiVideoPricing").seedAiVideoPricingIfMissing;
  await Promise.all([models.Settings.init(), models.Audit.init()]);
  console.log = () => {};
});

after(async () => {
  if (h) await h.close();
});

const reset = async () => {
  await models.Settings.deleteMany({});
  await models.Audit.deleteMany({});
  store.invalidate();
};

test("on a database with no saved settings the 30% profit price list is saved and used", opts, async () => {
  await reset();
  assert.equal(await seed(), true);

  const config = await store.get({ fresh: true });
  assert.equal(config.videoCost, 30);
  assert.equal(config.freeCredits, 30);
  assert.equal(config.maxScriptChars, 400);
  assert.deepEqual(config.packs.map(pack => [pack.credits, pack.price]), [[100, 600], [500, 3000], [1200, 7200]]);
  assert.deepEqual(config.plans.map(plan => [plan.id, plan.price, plan.yearlyPrice, plan.monthlyCredits]), [["free", 0, 0, 30], ["pro", 1800, 21600, 300], ["business", 6000, 72000, 1000]]);
  // Everything the preset does not set keeps its shipped default.
  assert.equal(config.enabled, true);
  assert.equal(config.maxConcurrentRenders, 3);

  const [entry] = await models.Audit.find({ action: "settings.seed" }).lean();
  assert.match(entry.summary, /30 credits per video/);
});

test("a new customer's studio starts with the new free credits and the app is offered the new prices", opts, async () => {
  await reset();
  await seed();
  const uid = new h.mongoose.Types.ObjectId();
  const studio = service.present(await service.getStudio(uid, null), await store.get({ fresh: true }));
  assert.equal(studio.credits, 30);
  assert.equal(studio.videoCost, 30);
  assert.deepEqual(studio.packs.map(pack => pack.price), [600, 3000, 7200]);
});

test("settings an admin saved are never overwritten, not even partly", opts, async () => {
  await reset();
  await store.update({ videoCost: 25, packs: [{ id: "pack_50", credits: 50, price: 199, active: true }] }, { _id: "64b0000000000000000000aa", name: "Admin" });
  assert.equal(await seed(), false);

  const config = await store.get({ fresh: true });
  assert.equal(config.videoCost, 25);
  assert.deepEqual(config.packs.map(pack => pack.id), ["pack_50"]);
  assert.equal(await models.Audit.countDocuments({ action: "settings.seed" }), 0);
});

test("running it again, or on several servers at once, saves it exactly once", opts, async () => {
  await reset();
  const results = await Promise.all([seed(), seed(), seed(), seed()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await seed(), false);
  assert.equal(await models.Settings.countDocuments({ key: "global" }), 1);
  assert.equal(await models.Audit.countDocuments({ action: "settings.seed" }), 1);
});

test("after the seed an admin can still change prices and the change sticks", opts, async () => {
  await reset();
  await seed();
  await store.update({ videoCost: 40 }, { _id: "64b0000000000000000000aa", name: "Admin" });
  assert.equal(await seed(), false);
  assert.equal((await store.get({ fresh: true })).videoCost, 40);
});
