// AI videos are never free: new studios start empty, and one startup step clears the starting
// balance an older settings document still carries. Throwaway local mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { hasMongod, bootHarness } = require("./helpers/aiVideoHarness");

let h;
let models;
let store;
let service;
let removeFreeCredits;
let Studio;
const opts = { skip: !hasMongod && "mongod is not installed" };

before(async () => {
  if (!hasMongod) return;
  h = await bootHarness();
  models = require("../src/modules/aiVideo/aiVideo.settings.model");
  store = require("../src/modules/aiVideo/aiVideo.settings");
  service = require("../src/modules/aiVideo/aiVideo.service");
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  removeFreeCredits = require("../src/startup/removeAiVideoFreeCredits").removeAiVideoFreeCreditsOnce;
  await Promise.all([models.Settings.init(), models.Audit.init(), Studio.init()]);
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
const admin = { _id: "64b0000000000000000000aa", name: "Admin" };
const saved = () => models.Settings.findOne({ key: "global" }).lean();

test("with nothing configured a studio starts at zero credits", () => {
  const read = env => {
    const result = spawnSync(process.execPath, ["-e", "process.stdout.write(String(require('./src/modules/aiVideo/aiVideo.logic').FREE_CREDITS))"], {
      cwd: path.join(__dirname, ".."),
      env: { PATH: process.env.PATH, ...env },
    });
    return result.stdout.toString();
  };
  assert.equal(read({}), "0");
  assert.equal(read({ AI_VIDEO_FREE_CREDITS: "" }), "0");
  assert.equal(read({ AI_VIDEO_FREE_CREDITS: "-5" }), "0");
  assert.equal(read({ AI_VIDEO_FREE_CREDITS: "60" }), "60", "an operator can still choose to grant some");
});

test("a saved starting balance is cleared once, along with the Free plan's monthly credits", opts, async () => {
  await reset();
  await store.update(
    { freeCredits: 90, plans: [{ id: "free", name: "Free", price: 0, yearlyPrice: 0, monthlyCredits: 90, active: true }, { id: "pro", name: "Pro", price: 1800, yearlyPrice: 21600, monthlyCredits: 300, active: true }], videoCost: 30 },
    admin,
  );
  assert.equal((await store.get({ fresh: true })).freeCredits, 90);

  assert.equal(await removeFreeCredits(), true);

  const config = await store.get({ fresh: true });
  assert.equal(config.freeCredits, 0);
  assert.deepEqual(config.plans.map(plan => [plan.id, plan.price, plan.monthlyCredits]), [["free", 0, 0], ["pro", 1800, 300]], "only the Free plan's credits change");
  assert.equal(config.videoCost, 30, "prices are left alone");

  const [entry] = await models.Audit.find({ action: "settings.free_credits_removed" }).lean();
  assert.match(entry.summary, /was 90/);
  assert.equal((await saved()).updatedBy, "system: no free credits");
});

test("a new customer is then created with nothing", opts, async () => {
  const uid = new h.mongoose.Types.ObjectId();
  const created = service.present(await service.getStudio(uid, null), await store.get({ fresh: true }));
  assert.equal(created.credits, 0);
});

test("credits customers already hold are not touched", opts, async () => {
  await reset();
  const uid = new h.mongoose.Types.ObjectId();
  await Studio.create({ userId: uid, businessId: null, credits: 90 });
  await store.update({ freeCredits: 90 }, admin);
  await removeFreeCredits();
  assert.equal((await Studio.findOne({ userId: uid })).credits, 90);
});

test("it runs once: an admin who grants credits later is not overruled at the next restart", opts, async () => {
  await reset();
  await store.update({ freeCredits: 90 }, admin);
  assert.equal(await removeFreeCredits(), true);
  assert.equal(await removeFreeCredits(), false);

  await store.update({ freeCredits: 25 }, admin);
  assert.equal(await removeFreeCredits(), false);
  assert.equal((await store.get({ fresh: true })).freeCredits, 25);
  assert.equal(await models.Audit.countDocuments({ action: "settings.free_credits_removed" }), 1);
});

test("with no saved settings it creates none, but still counts as done", opts, async () => {
  await reset();
  assert.equal(await removeFreeCredits(), true);
  assert.equal(await models.Settings.countDocuments(), 0);
  assert.equal(await models.Audit.countDocuments({ action: "settings.free_credits_removed" }), 1);

  await store.update({ freeCredits: 10 }, admin);
  assert.equal(await removeFreeCredits(), false);
  assert.equal((await store.get({ fresh: true })).freeCredits, 10);
});
