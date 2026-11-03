// A customer's own voice note drives the video: it is checked and converted, uploaded to the provider as
// audio, and the video is charged and refunded like any other. Real ffmpeg, throwaway local mongod,
// stand-in for HeyGen. Skipped when `mongod` is not installed.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { hasMongod, bootHarness } = require("./helpers/aiVideoHarness");

const opts = { skip: !hasMongod && "mongod is not installed" };
const ffmpeg = require("@ffmpeg-installer/ffmpeg").path;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "voice-fixtures-"));

let h;
let Studio;
let User;
let service;
let audio;
let logic;

// A tone of the given length in the given container, made by the same ffmpeg the server uses.
function recording(name, seconds, codecArgs = [], source = `sine=frequency=440:sample_rate=48000:duration=${seconds}`) {
  const file = path.join(scratch, name);
  const made = spawnSync(ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", source, ...codecArgs, file]);
  assert.equal(made.status, 0, `could not make ${name}: ${String(made.stderr).slice(-300)}`);
  return fs.readFileSync(file);
}
const whatsapp = seconds => recording(`wa-${seconds}.opus`, seconds, ["-c:a", "libopus", "-f", "ogg"]);
const upload = (buffer, extra = {}) => ({ buffer, originalname: "PTT-20261026-WA0007.opus", mimetype: "audio/ogg", size: buffer.length, ...extra });

async function newStudio(credits = 120) {
  const userId = new h.mongoose.Types.ObjectId();
  await Studio.create({ userId, businessId: null, credits, avatars: logic.seedAvatars() });
  return { userId, credits: async () => (await Studio.findOne({ userId })).credits, fresh: () => Studio.findOne({ userId }) };
}
const rejects = (promise, status, pattern) =>
  assert.rejects(promise, error => {
    assert.equal(error.status, status, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
const mockVideoCalls = () => h.mock.callsTo("POST", "/v3/videos");
const mockAssetCalls = () => h.mock.callsTo("POST", "/v3/assets");

before(async () => {
  h = await bootHarness();
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  User = require("../src/models/userModel");
  service = require("../src/modules/aiVideo/aiVideo.service");
  audio = require("../src/modules/aiVideo/aiVideo.audio");
  logic = require("../src/modules/aiVideo/aiVideo.logic");
  await Studio.init();
});

after(async () => {
  if (h) await h.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Checking and converting the recording
// ---------------------------------------------------------------------------

test("a WhatsApp voice note, an m4a, an mp3 and a wav all become mono WAV of the right length", opts, async () => {
  const cases = [
    ["WhatsApp opus", whatsapp(5), "PTT-1.opus", "audio/ogg", 5],
    ["m4a", recording("a.m4a", 7, ["-c:a", "aac"]), "Recording.m4a", "audio/mp4", 7],
    ["mp3", recording("a.mp3", 4, ["-c:a", "libmp3lame"]), "note.mp3", "audio/mpeg", 4],
    ["stereo wav", recording("a.wav", 8, ["-ac", "2"]), "note.wav", "audio/x-wav", 8],
    ["phone recorder labelled video/3gpp", recording("a.3gp", 6, ["-c:a", "aac", "-f", "3gp"]), "AUD-0001.3gp", "video/3gpp", 6],
    ["picker that only says octet-stream", whatsapp(3), "voice.opus", "application/octet-stream", 3],
  ];
  for (const [label, buffer, filename, mimetype, expected] of cases) {
    const result = await audio.prepareVoiceNote({ buffer, filename, mimetype });
    assert.ok(Math.abs(result.seconds - expected) < 0.3, `${label}: ${result.seconds}s`);
    assert.equal(result.mimetype, "audio/wav");
    assert.equal(result.buffer.subarray(0, 4).toString(), "RIFF", label);
    assert.equal(result.buffer.readUInt16LE(22), 1, `${label}: mono`);
    assert.equal(result.buffer.readUInt32LE(24), 44100, `${label}: sample rate`);
  }
});

test("thirty seconds is allowed, longer is refused with the limit in the message", opts, async () => {
  const ok = await audio.prepareVoiceNote({ buffer: whatsapp(30), filename: "a.opus", mimetype: "audio/ogg" });
  assert.ok(ok.seconds > 29.5 && ok.seconds <= 30.5);
  await rejects(audio.prepareVoiceNote({ buffer: whatsapp(33), filename: "a.opus", mimetype: "audio/ogg" }), 400, /up to 30 seconds/);
  // A ten minute file is cut off after a moment of decoding, not processed in full.
  const started = Date.now();
  await rejects(audio.prepareVoiceNote({ buffer: whatsapp(600), filename: "long.opus", mimetype: "audio/ogg" }), 400, /up to 30 seconds/);
  assert.ok(Date.now() - started < 15000, "a very long file is cut off early");
});

test("empty, too short, unreadable, oversized and non-audio uploads are refused", opts, async () => {
  await rejects(audio.prepareVoiceNote({ buffer: Buffer.alloc(0), filename: "a.opus", mimetype: "audio/ogg" }), 400, /empty/);
  await rejects(audio.prepareVoiceNote({ buffer: whatsapp(0.3), filename: "a.opus", mimetype: "audio/ogg" }), 400, /too short/);
  await rejects(audio.prepareVoiceNote({ buffer: Buffer.from("this is not audio at all, just text".repeat(50)), filename: "a.opus", mimetype: "audio/ogg" }), 400, /could not be read/);
  await rejects(audio.prepareVoiceNote({ buffer: Buffer.alloc(11 * 1024 * 1024, 1), filename: "a.wav", mimetype: "audio/wav" }), 400, /too large/);
  await rejects(audio.prepareVoiceNote({ buffer: whatsapp(5), filename: "photo.png", mimetype: "image/png" }), 400, /audio file/);
  await rejects(audio.prepareVoiceNote({ buffer: whatsapp(5), filename: "run.exe", mimetype: "application/octet-stream" }), 400, /audio file/);
});

test("temporary files are removed, and a crafted playlist cannot make the server fetch an address", opts, async () => {
  const leftovers = () => fs.readdirSync(os.tmpdir()).filter(name => name.startsWith("voice-note-")).length;
  const before = leftovers();
  await audio.prepareVoiceNote({ buffer: whatsapp(4), filename: "a.opus", mimetype: "audio/ogg" });
  await rejects(audio.prepareVoiceNote({ buffer: Buffer.from("garbage".repeat(100)), filename: "a.opus", mimetype: "audio/ogg" }), 400);
  assert.equal(leftovers(), before);

  let fetched = 0;
  const bait = http.createServer((req, res) => {
    fetched += 1;
    res.end("x");
  });
  await new Promise(resolve => bait.listen(0, "127.0.0.1", resolve));
  const playlist = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:5,\nhttp://127.0.0.1:${bait.address().port}/secret.ts\n#EXT-X-ENDLIST\n`;
  await rejects(audio.prepareVoiceNote({ buffer: Buffer.from(playlist), filename: "list.m3u8", mimetype: "audio/mpegurl" }), 400);
  await rejects(audio.prepareVoiceNote({ buffer: Buffer.from(playlist), filename: "list.mp3", mimetype: "audio/mpeg" }), 400);
  await new Promise(resolve => bait.close(resolve));
  assert.equal(fetched, 0, "ffmpeg was not allowed to follow the playlist");
});

// ---------------------------------------------------------------------------
// Making the video
// ---------------------------------------------------------------------------

test("a video from a photo avatar and a voice note: audio goes up as audio, the video is sent with it and charged once", opts, async () => {
  const { userId, credits } = await newStudio(120);
  const assetsBefore = mockAssetCalls().length;
  const videosBefore = mockVideoCalls().length;

  const result = await service.createProject(userId, null, { title: "My voice", format: "9:16", presenter: "priya", language: "hinglish", captions: "on" }, upload(whatsapp(12)));

  const cost = (await require("../src/modules/aiVideo/aiVideo.settings").get()).videoCost;
  assert.equal(result.credits, 120 - cost);
  assert.equal(await credits(), 120 - cost);
  assert.equal(result.project.status, "Rendering");
  assert.equal(result.project.script, "", "no script was needed");

  const [asset] = mockAssetCalls().slice(assetsBefore);
  assert.match(asset.contentType, /^multipart\/form-data/);
  const [video] = mockVideoCalls().slice(videosBefore);
  assert.equal(video.body.type, "avatar");
  assert.match(video.body.audio_asset_id, /^asset_\d+$/);
  assert.equal(video.body.script, undefined, "the provider is not asked to speak a script");
  assert.equal(video.body.voice_id, undefined);
  assert.equal(video.body.voice_settings, undefined);
  assert.ok(video.body.avatar_id);
  assert.equal(video.body.aspect_ratio, "9:16");
  assert.ok(video.headers["idempotency-key"]);

  const stored = (await Studio.findOne({ userId })).projects[0];
  assert.equal(stored.voice, "own");
  assert.ok(Math.abs(stored.audioSeconds - 12) < 0.3);
  assert.equal(stored.durationSeconds, stored.audioSeconds);
  assert.equal(stored.duration, "00:12");
  const sentAsset = h.mock.assets.get(video.body.audio_asset_id);
  assert.equal(sentAsset.mime, "audio/wav");
  assert.equal(sentAsset.filename, "voice.wav");
});

test("the script is optional with a voice note, and when given it is kept for the customer but not sent", opts, async () => {
  const { userId } = await newStudio();
  const videosBefore = mockVideoCalls().length;
  const result = await service.createProject(userId, null, { title: "With text", script: "Diwali sale: 50% off everything", presenter: "raj", format: "16:9" }, upload(whatsapp(6)));
  assert.equal(result.project.script, "Diwali sale: 50% off everything");
  const [video] = mockVideoCalls().slice(videosBefore);
  assert.equal(video.body.script, undefined);
  assert.ok(video.body.audio_asset_id);
});

test("without a voice note nothing changes: the script and a stock voice are sent", opts, async () => {
  const { userId } = await newStudio();
  const videosBefore = mockVideoCalls().length;
  const assetsBefore = mockAssetCalls().length;
  await service.createProject(userId, null, { title: "Stock", script: "Hello from a stock voice", presenter: "priya", voice: "priya" });
  const [video] = mockVideoCalls().slice(videosBefore);
  assert.equal(video.body.script, "Hello from a stock voice");
  assert.ok(video.body.voice_id);
  assert.equal(video.body.audio_asset_id, undefined);
  assert.equal(mockAssetCalls().length, assetsBefore, "no audio upload");
});

test("a voice note that is too long or unreadable costs nothing and never reaches the provider", opts, async () => {
  const { userId, credits } = await newStudio(120);
  const assetsBefore = mockAssetCalls().length;
  const videosBefore = mockVideoCalls().length;
  await rejects(service.createProject(userId, null, { title: "Long" }, upload(whatsapp(45))), 400, /up to 30 seconds/);
  await rejects(service.createProject(userId, null, { title: "Bad" }, upload(Buffer.from("nope".repeat(200)))), 400, /could not be read/);
  assert.equal(await credits(), 120);
  assert.equal((await Studio.findOne({ userId })).projects.length, 0);
  assert.equal(mockAssetCalls().length, assetsBefore);
  assert.equal(mockVideoCalls().length, videosBefore);
});

test("not enough credits is refused before the recording is even processed", opts, async () => {
  const { userId, credits } = await newStudio(5);
  const assetsBefore = mockAssetCalls().length;
  await rejects(service.createProject(userId, null, { title: "Poor" }, upload(whatsapp(5))), 400, /credits/);
  assert.equal(await credits(), 5);
  assert.equal(mockAssetCalls().length, assetsBefore);
});

test("two quick taps cannot spend the same credits twice with voice notes either", opts, async () => {
  const cost = (await require("../src/modules/aiVideo/aiVideo.settings").get()).videoCost;
  const { userId, credits } = await newStudio(cost);
  const attempts = await Promise.allSettled([
    service.createProject(userId, null, { title: "One" }, upload(whatsapp(4))),
    service.createProject(userId, null, { title: "Two" }, upload(whatsapp(4))),
  ]);
  assert.equal(attempts.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(await credits(), 0);
  assert.equal((await Studio.findOne({ userId })).projects.length, 1);
});

test("if the provider refuses the video the credits come straight back and no project is left", opts, async () => {
  const cost = (await require("../src/modules/aiVideo/aiVideo.settings").get()).videoCost;
  const { userId, credits } = await newStudio(cost * 2);
  await rejects(service.createProject(userId, null, { title: "FAIL400 please" }, upload(whatsapp(5))), 400);
  assert.equal(await credits(), cost * 2);
  assert.equal((await Studio.findOne({ userId })).projects.filter(project => project.status === "Rendering").length, 0);
});

test("the finished video is stored like any other", opts, async () => {
  const { userId, fresh } = await newStudio();
  const { project } = await service.createProject(userId, null, { title: "Finish me" }, upload(whatsapp(5)));
  const videoId = (await fresh()).projects.find(item => item.id === project.id).heygenVideoId;
  h.mock.finish(videoId);
  const studio = await service.getStudio(userId, null);
  const done = studio.projects.find(item => item.id === project.id);
  assert.equal(done.status, "Completed");
  assert.ok(done.videoUrl);
});

// ---------------------------------------------------------------------------
// Through the real route, as the app sends it
// ---------------------------------------------------------------------------

test("the route takes a multipart voice note for a signed-in customer and still takes plain JSON", opts, async () => {
  process.env.JWT_SECRET = "voice-test-secret";
  const jwt = require("jsonwebtoken");
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/api", require("../src/modules/aiVideo/aiVideo.routes"));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/ai-video/projects`;
  try {
    const user = await User.create({ name: "Voice caller", mobile: 9877700001 });
    const token = jwt.sign({ User: user._id, userId: user._id }, process.env.JWT_SECRET);
    await Studio.create({ userId: user._id, businessId: null, credits: 200, avatars: logic.seedAvatars() });
    const headers = { authorization: `Bearer ${token}` };
    const videosBefore = mockVideoCalls().length;

    const form = new FormData();
    form.append("title", "From the app");
    form.append("script", "");
    form.append("format", "9:16");
    form.append("presenter", "priya");
    form.append("language", "hinglish");
    form.append("captions", "on");
    form.append("voice", new Blob([whatsapp(9)], { type: "audio/ogg" }), "PTT-20261026-WA0009.opus");
    const sent = await fetch(base, { method: "POST", headers, body: form });
    const body = await sent.json();
    assert.equal(sent.status, 201, JSON.stringify(body));
    assert.equal(body.data.project.status, "Rendering");
    assert.ok(mockVideoCalls().slice(videosBefore).pop().body.audio_asset_id);

    const tooLong = new FormData();
    tooLong.append("title", "Too long");
    tooLong.append("voice", new Blob([whatsapp(41)], { type: "audio/ogg" }), "long.opus");
    const refused = await fetch(base, { method: "POST", headers, body: tooLong });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).message, /up to 30 seconds/);

    const json = await fetch(base, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ title: "Plain", script: "Just a script", presenter: "priya", voice: "priya" }) });
    assert.equal(json.status, 201);
    assert.equal(mockVideoCalls().slice(videosBefore).pop().body.script, "Just a script");

    const anonymous = await fetch(base, { method: "POST", body: form });
    assert.equal(anonymous.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
