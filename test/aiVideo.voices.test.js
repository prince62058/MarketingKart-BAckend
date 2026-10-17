// The voice library: browse HeyGen's public voices, pick one, and have it really reach the render.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootHarness } = require("./helpers/aiVideoHarness");

let h;
let service;
let catalog;
let Studio;
const opts = { skip: !hasMongod && "mongod is not installed" };
const uid = () => new h.mongoose.Types.ObjectId();

before(async () => {
  if (!hasMongod) return;
  h = await bootHarness();
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  service = require("../src/modules/aiVideo/aiVideo.service");
  catalog = require("../src/modules/aiVideo/heygen.catalog");
  await Studio.init();
});
after(async () => {
  if (h) await h.close();
});
beforeEach(() => {
  if (hasMongod) catalog.clearCache();
});

test("the library lists public voices for a language and narrows by gender and name", opts, async () => {
  const all = await service.listVoices({ language: "hindi" });
  assert.equal(all.voices.length, 4);
  assert.deepEqual(Object.keys(all.voices[0]).sort(), ["gender", "id", "language", "name", "previewUrl"]);
  assert.ok(all.voices.every(voice => voice.id.startsWith("hg:")));
  assert.deepEqual(all.voices.map(voice => voice.name), [...all.voices.map(voice => voice.name)].sort((a, b) => a.localeCompare(b)));

  const women = await service.listVoices({ language: "hindi", gender: "female" });
  assert.deepEqual(women.voices.map(voice => voice.name).sort(), ["Riya Mehta", "Saanu"]);
  const found = await service.listVoices({ language: "hindi", search: "  manu " });
  assert.deepEqual(found.voices.map(voice => voice.name), ["Manu"]);
  const english = await service.listVoices({ language: "english" });
  assert.equal(english.voices.length, 2);
  // Hinglish uses the Hindi voices.
  assert.equal((await service.listVoices({ language: "hinglish" })).voices.length, 4);
});

test("a voice picked from the library is the one the video is rendered with", opts, async () => {
  const userId = uid();
  await service.getStudio(userId, null);
  await service.createProject(userId, null, { script: "Namaste doston, yeh ek test hai.", presenter: "priya", voice: "hg:v-hi-m2" });
  const sent = h.mock.callsTo("POST", "/v3/videos").pop().body;
  assert.equal(sent.voice_id, "v-hi-m2");
});

test("a voice that does not exist is refused before any credit is spent", opts, async () => {
  const userId = uid();
  await service.getStudio(userId, null);
  const before = (await Studio.findOne({ userId })).credits;
  await assert.rejects(
    service.createProject(userId, null, { script: "Namaste doston, yeh ek test hai.", presenter: "priya", voice: "hg:nope" }),
    error => error.status === 400 && /no longer available/.test(error.message),
  );
  assert.equal((await Studio.findOne({ userId })).credits, before);
});

test("a library voice can be previewed and saved on an avatar, and shows by name", opts, async () => {
  const userId = uid();
  const studio = await service.getStudio(userId, null);
  const preview = await service.voicePreview({ voice: "hg:v-hi-f2", language: "hindi" });
  assert.equal(preview.name, "Saanu");
  assert.match(preview.previewUrl, /v-hi-f2\.mp3$/);

  const saved = await service.updateAvatar(userId, null, "priya", { voice: "hg:v-hi-f2" });
  assert.equal(saved.avatar.voice, "hg:v-hi-f2");
  assert.equal(saved.avatar.voiceName, "Saanu");
  // Going back to a stock voice clears the stored name.
  const back = await service.updateAvatar(userId, null, "priya", { voice: "kavya" });
  assert.equal(back.avatar.voiceName, null);
  await assert.rejects(service.updateAvatar(userId, null, "priya", { voice: "hg:ghost" }), error => error.status === 400);
  await assert.rejects(service.updateAvatar(userId, null, "priya", { voice: "not-a-voice" }), error => error.status === 400);
  assert.ok(studio);
});

test("the voiceover uses a library voice too", opts, async () => {
  const userId = uid();
  await service.getStudio(userId, null);
  await service.createVoiceover(userId, null, { script: "Namaste doston.", voice: "hg:v-hi-m1", language: "hindi" });
  assert.equal(h.mock.callsTo("POST", "/v3/voices/speech").pop().body.voice_id, "v-hi-m1");
});
