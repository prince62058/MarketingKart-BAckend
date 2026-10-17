const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootHarness, putBytes } = require("./helpers/aiVideoHarness");

let h;
let Studio;
let logic;
let avatars;
let heygen;
const opts = { skip: !hasMongod && "mongod is not installed" };

const footage = n => Buffer.alloc(n, 7);
const MB = 1024 * 1024;

async function newStudio(credits = 120) {
  const mongoose = h.mongoose;
  const userId = new mongoose.Types.ObjectId();
  await Studio.create({ userId, credits, avatars: logic.seedAvatars() });
  const fresh = () => Studio.findOne({ userId });
  return { userId, fresh };
}

const init = (studio, extra = {}) =>
  avatars.initVideoAvatar({ studio, input: { name: "Founder", filename: "me.mp4", contentType: "video/mp4", sizeBytes: 2 * MB, ...extra } });

before(async () => {
  if (!hasMongod) return;
  h = await bootHarness();
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  await Studio.init();
  logic = require("../src/modules/aiVideo/aiVideo.logic");
  avatars = require("../src/modules/aiVideo/aiVideo.avatars");
  heygen = require("../src/modules/aiVideo/heygen.client");
});
after(async () => {
  if (h) await h.close();
});

test("init validates the footage before asking HeyGen for an upload slot", opts, async () => {
  const { fresh } = await newStudio();
  const before = h.mock.calls.length;
  for (const bad of [{ contentType: "video/quicktime" }, { contentType: "image/png" }, { sizeBytes: 100 }, { sizeBytes: 201 * MB }, { sizeBytes: "big" }]) {
    await assert.rejects(init(await fresh(), bad), error => error.status === 400, JSON.stringify(bad));
  }
  assert.equal(h.mock.calls.length, before, "nothing reached the provider");
});

test("a video avatar goes from upload, to training, to consent, to ready", opts, async () => {
  const { fresh } = await newStudio();
  const started = await init(await fresh());
  assert.equal(started.avatar.status, "Uploading");
  assert.equal(started.avatar.kind, "clone");
  assert.ok(!JSON.stringify(started.avatar).includes("asset_"), "provider ids stay on the server");
  assert.match(started.upload.url, /\/upload\/asset_\d+$/);
  assert.equal(started.upload.headers["Content-Type"], "video/mp4");
  const directUpload = h.mock.callsTo("POST", "/v3/assets/direct-uploads").pop();
  assert.deepEqual(directUpload.body, { filename: "me.mp4", content_type: "video/mp4", size_bytes: 2 * MB });
  assert.ok(directUpload.headers["idempotency-key"]);

  // Finishing before the bytes arrive is refused and the slot stays open for a retry.
  await assert.rejects(avatars.completeVideoAvatar({ studio: await fresh(), avatarId: started.avatar.id }), error => error.status === 400);
  assert.equal((await fresh()).avatars.find(a => a.id === started.avatar.id).status, "Uploading");

  // The phone sends the bytes straight to storage, then confirms.
  assert.equal(await putBytes(started.upload, footage(2 * MB)), 200);
  const done = await avatars.completeVideoAvatar({ studio: await fresh(), avatarId: started.avatar.id });
  assert.equal(done.avatar.status, "Processing");
  const twin = h.mock.callsTo("POST", "/v3/avatars").pop();
  assert.equal(twin.body.type, "digital_twin");
  assert.equal(twin.body.name, "Founder");
  assert.deepEqual(Object.keys(twin.body.file).sort(), ["asset_id", "type"]);
  assert.equal(twin.body.file.type, "asset_id");

  const stored = (await fresh()).avatars.find(a => a.id === started.avatar.id);
  assert.ok(stored.heygenLookId && stored.heygenGroupId);
  assert.equal(stored.defaultVoiceId, `voice_clone_${stored.heygenLookId.split("_")[1]}`);

  // Training finishes, but the person has not approved yet.
  h.mock.finishLook(stored.heygenLookId);
  let studio = await fresh();
  assert.equal(await avatars.refreshTwin({ studio, avatar: studio.avatars.find(a => a.id === stored.id) }), true);
  assert.equal((await fresh()).avatars.find(a => a.id === stored.id).status, "Consent needed");

  // The consent link comes from HeyGen; it is only requested on demand.
  const consent = await avatars.requestConsent({ studio: await fresh(), avatarId: stored.id });
  assert.match(consent.url, /\/consent\/grp_\d+$/);
  assert.equal(consent.consent, "pending");
  assert.equal((await fresh()).avatars.find(a => a.id === stored.id).status, "Consent needed");

  h.mock.setConsent(stored.heygenGroupId, "accepted");
  studio = await fresh();
  await avatars.refreshTwin({ studio, avatar: studio.avatars.find(a => a.id === stored.id) });
  const ready = (await fresh()).avatars.find(a => a.id === stored.id);
  assert.equal(ready.status, "Ready");
  assert.equal(ready.consentStatus, "accepted");
  assert.equal(avatars.present(ready).consent, "accepted");
  assert.equal(avatars.present(ready).previewVideoUrl.endsWith(".mp4"), true);

  // Once approved there is nothing left to collect.
  assert.deepEqual(await avatars.requestConsent({ studio: await fresh(), avatarId: stored.id }), { consent: "accepted", url: null });
});

test("rejected consent sends the person back to record it again", opts, async () => {
  const { fresh } = await newStudio();
  const started = await init(await fresh());
  await putBytes(started.upload, footage(2 * MB));
  await avatars.completeVideoAvatar({ studio: await fresh(), avatarId: started.avatar.id });
  let stored = (await fresh()).avatars[2];
  h.mock.finishLook(stored.heygenLookId);
  h.mock.setConsent(stored.heygenGroupId, "rejected");
  const studio = await fresh();
  await avatars.refreshTwin({ studio, avatar: studio.avatars[2] });
  stored = (await fresh()).avatars[2];
  assert.equal(stored.status, "Consent needed");
  assert.match(stored.error, /Record it again/);
});

test("unusable footage fails the avatar and returns the credits", opts, async () => {
  const { fresh } = await newStudio(100);
  const started = await init(await fresh(), { name: "BADFOOTAGE" });
  await putBytes(started.upload, footage(2 * MB));
  await assert.rejects(avatars.completeVideoAvatar({ studio: await fresh(), avatarId: started.avatar.id, cost: 40 }), error => {
    assert.equal(error.status, 400);
    assert.match(error.message, /No face was detected/);
    return true;
  });
  const studio = await fresh();
  assert.equal(studio.credits, 100);
  assert.equal(studio.avatars[2].status, "Failed");
});

test("a training failure refunds exactly once and shows a friendly reason", opts, async () => {
  const { fresh } = await newStudio(100);
  const started = await init(await fresh());
  await putBytes(started.upload, footage(2 * MB));
  await avatars.completeVideoAvatar({ studio: await fresh(), avatarId: started.avatar.id, cost: 40 });
  assert.equal((await fresh()).credits, 60);
  const stored = (await fresh()).avatars[2];
  h.mock.failLook(stored.heygenLookId, "moderation_failed");
  for (let i = 0; i < 3; i++) {
    const studio = await fresh();
    await avatars.refreshTwin({ studio, avatar: studio.avatars[2] });
  }
  const studio = await fresh();
  assert.equal(studio.credits, 100);
  assert.equal(studio.avatars[2].status, "Failed");
  assert.match(studio.avatars[2].error, /content review/);
  assert.doesNotMatch(studio.avatars[2].error, /internal/);
  await assert.rejects(avatars.requestConsent({ studio, avatarId: stored.id }), error => error.status === 400);
});

test("not enough credits stops before anything is created on HeyGen", opts, async () => {
  const { fresh } = await newStudio(10);
  const started = await init(await fresh());
  await putBytes(started.upload, footage(2 * MB));
  const before = h.mock.callsTo("POST", "/v3/avatars").length;
  await assert.rejects(avatars.completeVideoAvatar({ studio: await fresh(), avatarId: started.avatar.id, cost: 40 }), error => error.status === 400 && /need 40 credits/.test(error.message));
  assert.equal(h.mock.callsTo("POST", "/v3/avatars").length, before);
  assert.equal((await fresh()).credits, 10);
  assert.equal((await fresh()).avatars[2].status, "Uploading");
});

test("a provider outage on creation returns the charge and leaves the slot open to retry", opts, async () => {
  const { fresh } = await newStudio(100);
  const started = await init(await fresh());
  await putBytes(started.upload, footage(2 * MB));
  const key = process.env.HEYGEN_BASE_URL;
  const original = heygen.createDigitalTwin;
  heygen.createDigitalTwin = async () => {
    throw new heygen.HeyGenError("Could not reach the video provider", { status: 502, code: "network_error" });
  };
  try {
    await assert.rejects(avatars.completeVideoAvatar({ studio: await fresh(), avatarId: started.avatar.id, cost: 40 }), error => error.status === 503);
  } finally {
    heygen.createDigitalTwin = original;
    process.env.HEYGEN_BASE_URL = key;
  }
  const studio = await fresh();
  assert.equal(studio.credits, 100);
  assert.equal(studio.avatars[2].status, "Uploading");
  const retried = await avatars.completeVideoAvatar({ studio, avatarId: started.avatar.id, cost: 40 });
  assert.equal(retried.avatar.status, "Processing");
  assert.equal((await fresh()).credits, 60);
});

test("custom avatars are capped, and stale unfinished uploads do not count", opts, async () => {
  const { fresh } = await newStudio();
  for (let i = 0; i < avatars.MAX_CUSTOM_AVATARS; i++) await init(await fresh(), { name: `A${i}` });
  await assert.rejects(init(await fresh()), error => error.status === 400 && /up to 5/.test(error.message));
  // Two hours later the unfinished slots are abandoned and can be reclaimed.
  await Studio.updateOne({ _id: (await fresh())._id }, { $set: { "avatars.$[a].createdAt": new Date(Date.now() - 2 * 60 * 60 * 1000) } }, { arrayFilters: [{ "a.kind": "clone" }] });
  const again = await init(await fresh(), { name: "Fresh" });
  assert.equal(again.avatar.status, "Uploading");
  assert.equal((await fresh()).avatars.filter(a => a.kind === "clone").length, 1);
});

test("removing an avatar deletes it on HeyGen, but never a stock presenter or one that is rendering", opts, async () => {
  const { fresh } = await newStudio();
  const started = await init(await fresh());
  await putBytes(started.upload, footage(2 * MB));
  await avatars.completeVideoAvatar({ studio: await fresh(), avatarId: started.avatar.id });
  const stored = (await fresh()).avatars[2];

  await assert.rejects(avatars.removeAvatar({ studio: await fresh(), avatarId: "priya" }), error => error.status === 404);

  await Studio.updateOne({ _id: (await fresh())._id }, { $push: { projects: { id: "p1", title: "x", status: "Rendering", presenter: stored.id } } });
  await assert.rejects(avatars.removeAvatar({ studio: await fresh(), avatarId: stored.id }), error => error.status === 400 && /still rendering/.test(error.message));
  await Studio.updateOne({ _id: (await fresh())._id }, { $pull: { projects: { id: "p1" } } });

  assert.deepEqual(await avatars.removeAvatar({ studio: await fresh(), avatarId: stored.id }), { deleted: true });
  assert.equal(h.mock.callsTo("DELETE", `/v3/avatars/${stored.heygenGroupId}`).length, 1);
  assert.equal((await fresh()).avatars.length, 2);
  assert.equal(h.mock.groups.has(stored.heygenGroupId), false);
});

test("voice and pitch are the only look settings accepted, and the saved pitch is used when rendering", opts, async () => {
  const service = require("../src/modules/aiVideo/aiVideo.service");
  const { userId } = await newStudio();
  await service.getStudio(userId, null);
  const set = body => service.updateAvatar(userId, null, "priya", body);

  for (const bad of [{ voice: "robot" }, { voice: "cloned" }, { pitch: "squeaky" }, { name: "  " }]) {
    await assert.rejects(set(bad), error => error.status === 400, JSON.stringify(bad));
  }
  const saved = await set({ voice: "kavya", pitch: "lower", attire: "kurta", background: "outdoor", status: "Failed" });
  assert.equal(saved.avatar.voice, "kavya");
  assert.equal(saved.avatar.pitch, "lower");
  assert.equal(saved.avatar.status, "Ready", "status is never client-editable");
  const stored = (await Studio.findOne({ userId })).avatars.find(a => a.id === "priya");
  assert.equal(stored.attire, "blazer", "settings the provider cannot apply are ignored, not stored");

  await service.createProject(userId, null, { script: "Namaste doston, yeh ek test hai.", presenter: "priya", voice: "kavya" });
  assert.deepEqual(h.mock.callsTo("POST", "/v3/videos").pop().body.voice_settings, { speed: 1, pitch: -3 });

  await set({ pitch: "natural" });
  await service.createProject(userId, null, { script: "Namaste doston, yeh doosra test hai.", presenter: "priya", voice: "kavya" });
  assert.deepEqual(h.mock.callsTo("POST", "/v3/videos").pop().body.voice_settings, { speed: 1 });
});
