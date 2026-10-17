// Proves the admin Settings page really drives the product, not just a form that saves.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootHarness, putBytes } = require("./helpers/aiVideoHarness");

let h;
let service;
let settings;
let Studio;
let logic;
let catalog;
const opts = { skip: !hasMongod && "mongod is not installed" };
const admin = { _id: "64b0000000000000000000aa", name: "Test Admin" };

const uid = () => new h.mongoose.Types.ObjectId();
const studioOf = userId => Studio.findOne({ userId });
const save = patch => settings.update(patch, admin);

before(async () => {
  if (!hasMongod) return;
  h = await bootHarness();
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  logic = require("../src/modules/aiVideo/aiVideo.logic");
  settings = require("../src/modules/aiVideo/aiVideo.settings");
  service = require("../src/modules/aiVideo/aiVideo.service");
  catalog = require("../src/modules/aiVideo/heygen.catalog");
  await Studio.init();
});
after(async () => {
  if (h) await h.close();
});
beforeEach(async () => {
  if (!hasMongod) return;
  await settings.Settings.deleteMany({});
  settings.invalidate();
  catalog.clearCache();
});

test("switching AI video off stops everything that spends money, but people can still look", opts, async () => {
  const userId = uid();
  await service.getStudio(userId, null);
  await save({ enabled: false });
  const before = h.mock.calls.length;
  const paused = error => error.status === 503 && /paused for maintenance/.test(error.message);

  await assert.rejects(service.createProject(userId, null, { script: "Namaste doston, yeh ek test hai.", presenter: "priya" }), paused);
  await assert.rejects(service.createVoiceover(userId, null, { script: "Namaste", voice: "priya" }), paused);
  await assert.rejects(service.saveAvatar(userId, null, { name: "Me" }, { buffer: Buffer.from("x"), originalname: "a.jpg", mimetype: "image/jpeg" }), paused);
  await assert.rejects(service.initVideoAvatar(userId, null, { contentType: "video/mp4", sizeBytes: 2 * 1024 * 1024 }), paused);

  assert.equal(h.mock.calls.length, before, "nothing reached the provider");
  assert.equal((await studioOf(userId)).credits, 120, "nothing was charged");
  const view = service.present(await service.getStudio(userId, null), await settings.get());
  assert.equal(view.enabled, false);

  await save({ enabled: true });
  assert.equal((await service.createProject(userId, null, { script: "Namaste doston, yeh ek test hai.", presenter: "priya" })).credits, 100);
});

test("video and voiceover prices come from settings, and the app is told the same numbers", opts, async () => {
  await save({ videoCost: 35, voiceoverCost: 5 });
  const userId = uid();
  const created = await service.createProject(userId, null, { script: "Namaste doston, yeh ek test hai.", presenter: "priya" });
  assert.equal(created.credits, 85);
  assert.equal((await studioOf(userId)).projects[0].cost, 35);
  assert.equal((await service.createVoiceover(userId, null, { script: "Namaste doston", voice: "priya" })).credits, 80);

  const view = service.present(await studioOf(userId), await settings.get());
  assert.equal(view.videoCost, 35);
  assert.equal(view.voiceoverCost, 5);

  await save({ videoCost: 90 });
  await assert.rejects(service.createProject(userId, null, { script: "Namaste doston, yeh ek test hai.", presenter: "priya" }), error => /need 90 credits/.test(error.message));
});

test("a failed render returns the price that was charged, even if the price changed since", opts, async () => {
  await save({ videoCost: 35 });
  const userId = uid();
  const created = await service.createProject(userId, null, { script: "RENDERFAIL please", presenter: "priya" });
  await save({ videoCost: 50 });
  const studio = await studioOf(userId);
  h.mock.fail(studio.projects[0].heygenVideoId);
  const { credits } = await service.getProject(userId, null, created.project.id);
  assert.equal(credits, 120, "35 back, not 50");
});

test("new studios start with the configured free credits, existing ones are untouched", opts, async () => {
  const early = uid();
  await service.getStudio(early, null);
  await save({ freeCredits: 40 });
  const late = uid();
  await service.getStudio(late, null);
  assert.equal((await studioOf(early)).credits, 120);
  assert.equal((await studioOf(late)).credits, 40);
});

test("script length, parallel renders and resolution follow settings", opts, async () => {
  await save({ maxScriptChars: 200, maxConcurrentRenders: 1, resolution: "720p" });
  const userId = uid();
  await assert.rejects(service.createProject(userId, null, { script: "word ".repeat(60), presenter: "priya" }), error => error.status === 400 && /under 200 characters/.test(error.message));
  await service.createProject(userId, null, { script: "Namaste doston, yeh ek test hai.", presenter: "priya" });
  assert.equal(h.mock.callsTo("POST", "/v3/videos").pop().body.resolution, "720p");
  await assert.rejects(service.createProject(userId, null, { script: "Doosra video abhi nahi, pehla poora ho jaye.", presenter: "priya" }), error => /already have videos rendering/.test(error.message));
});

test("the price list on sale is the one the admin set, and a purchase is checked against it", opts, async () => {
  await save({
    packs: [
      { id: "pack_50", credits: 50, price: 149, active: true },
      { id: "pack_old", credits: 100, price: 299, active: false },
    ],
    plans: [
      { id: "free", name: "Free", price: 0, yearlyPrice: 0, monthlyCredits: 120, active: true },
      { id: "gold", name: "Gold", price: 999, yearlyPrice: 9999, monthlyCredits: 2500, active: true },
      { id: "retired", name: "Retired", price: 100, yearlyPrice: 1000, monthlyCredits: 10, active: false },
    ],
  });
  const userId = uid();
  await service.getStudio(userId, null);
  const view = service.present(await studioOf(userId), await settings.get());
  assert.deepEqual(view.packs.map(p => p.id), ["pack_50"], "inactive packs are not shown");
  assert.deepEqual(view.plans.map(p => p.id), ["free", "gold"]);

  const wallet = input => service.createOrder(userId, null, { method: "wallet", ...input });
  const order = await wallet({ kind: "pack", packId: "pack_50" });
  assert.equal(order.order.price, 149);
  assert.equal(order.order.credits, 50);
  const plan = await wallet({ kind: "plan", planId: "gold", billing: "yearly" });
  assert.equal(plan.order.price, 9999);
  assert.equal(plan.order.credits, 2500 * 12);

  await assert.rejects(wallet({ kind: "pack", packId: "pack_old" }), error => error.status === 400);
  await assert.rejects(wallet({ kind: "pack", packId: "pack_100" }), error => error.status === 400, "an old price list entry is gone");
  await assert.rejects(wallet({ kind: "plan", planId: "retired", billing: "monthly" }), error => error.status === 400);
  // A client can only ever name an item; it can never send its own amount.
  const sneaky = await wallet({ kind: "pack", packId: "pack_50", price: 1, amount: 1 });
  assert.equal(sneaky.order.price, 149);
});

test("avatar creation prices come from settings and are returned when the avatar fails", opts, async () => {
  await save({ photoAvatarCost: 25, videoAvatarCost: 60 });
  const userId = uid();
  await service.getStudio(userId, null);

  const photo = { buffer: Buffer.from("fake-jpeg"), originalname: "me.jpg", mimetype: "image/jpeg" };
  const { avatar } = await service.saveAvatar(userId, null, { name: "Photo" }, photo);
  assert.equal((await studioOf(userId)).credits, 95);
  const photoLook = (await studioOf(userId)).avatars.find(a => a.id === avatar.id).heygenLookId;
  h.mock.failLook(photoLook);
  for (let i = 0; i < 3; i++) await service.getAvatar(userId, null, avatar.id);
  assert.equal((await studioOf(userId)).credits, 120, "refunded exactly once");

  const started = await service.initVideoAvatar(userId, null, { name: "Twin", filename: "me.mp4", contentType: "video/mp4", sizeBytes: 2 * 1024 * 1024 });
  await putBytes(started.upload, Buffer.alloc(2 * 1024 * 1024, 5));
  const twin = await service.completeVideoAvatar(userId, null, started.avatar.id);
  assert.equal(twin.avatar.status, "Processing");
  assert.equal((await studioOf(userId)).credits, 60);
});

test("a video avatar is used only once it is approved, and speaks in its own cloned voice", opts, async () => {
  const userId = uid();
  await service.getStudio(userId, null);
  const started = await service.initVideoAvatar(userId, null, { name: "Twin", filename: "me.mp4", contentType: "video/mp4", sizeBytes: 2 * 1024 * 1024 });
  await putBytes(started.upload, Buffer.alloc(2 * 1024 * 1024, 5));
  await service.completeVideoAvatar(userId, null, started.avatar.id);
  const script = "Namaste doston, yeh mera apna avatar hai.";

  await assert.rejects(service.createProject(userId, null, { script, presenter: started.avatar.id }), error => /still being created/.test(error.message));

  const stored = (await studioOf(userId)).avatars.find(a => a.id === started.avatar.id);
  h.mock.finishLook(stored.heygenLookId);
  await service.getAvatar(userId, null, started.avatar.id);
  await assert.rejects(service.createProject(userId, null, { script, presenter: started.avatar.id }), error => /consent video/.test(error.message));
  assert.equal((await studioOf(userId)).credits, 120, "refused before charging");

  const consent = await service.requestAvatarConsent(userId, null, started.avatar.id);
  assert.match(consent.url, /\/consent\//);
  h.mock.setConsent(stored.heygenGroupId, "accepted");
  assert.equal((await service.getAvatar(userId, null, started.avatar.id)).avatar.status, "Ready");

  await service.createProject(userId, null, { script, presenter: started.avatar.id, voice: "cloned" });
  const body = h.mock.callsTo("POST", "/v3/videos").pop().body;
  assert.equal(body.avatar_id, stored.heygenLookId);
  assert.equal(body.voice_id, (await studioOf(userId)).avatars.find(a => a.id === started.avatar.id).defaultVoiceId);
  assert.match(body.voice_id, /^voice_clone_/);

  // Picking a stock voice instead still works for the same avatar.
  await service.createProject(userId, null, { script, presenter: started.avatar.id, voice: "aarav", language: "english" });
  assert.equal(h.mock.callsTo("POST", "/v3/videos").pop().body.voice_id, "v-en-m1");

  assert.deepEqual(await service.removeAvatar(userId, null, started.avatar.id).catch(e => ({ status: e.status })), { status: 400 }, "cannot remove it while a video is rendering with it");
});
