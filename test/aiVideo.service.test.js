// Runs the real AI video service against a throwaway local mongod and a mock HeyGen server.
// Never touches the database in .env. Skipped when `mongod` is not installed.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const hasMongod = spawnSync("mongod", ["--version"]).status === 0;

let mongod;
let dbDir;
let mongoose;
let mock;
let service;
let logic;
let Studio;
const uploads = [];
const stub = { storageDown: false };

function freePort() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const readBody = req =>
  new Promise(resolve => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

const VOICES = {
  Hindi: [
    { voice_id: "v-hi-m1", name: "Luminous Laksh", language: "Hindi", gender: "male" },
    { voice_id: "v-hi-f1", name: "Riya Mehta", language: "Hindi", gender: "female" },
    { voice_id: "v-hi-m2", name: "Manu", language: "Hindi", gender: "male" },
    { voice_id: "v-hi-f2", name: "Saanu", language: "Hindi", gender: "female" },
  ],
  English: [
    { voice_id: "v-en-f1", name: "Elowen - Warm", language: "English", gender: "female" },
    { voice_id: "v-en-m1", name: "Lucian - Easygoing", language: "English", gender: "male" },
  ],
};

for (const list of Object.values(VOICES)) for (const voice of list) voice.preview_audio_url = `https://samples.test/${voice.voice_id}.mp3`;

// A stand-in for HeyGen's v3 API, shaped from its published OpenAPI spec.
function selfSignedCert(dir) {
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
  if (made.status !== 0) throw new Error(`openssl failed: ${made.stderr}`);
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

async function startMockHeyGen() {
  const port = await freePort();
  const base = `https://127.0.0.1:${port}`;
  const state = {
    base,
    calls: [],
    videos: new Map(),
    looks: new Map([
      ["preset-priya", { id: "preset-priya", name: "Priya preset", avatar_type: "photo_avatar", status: "completed", supported_api_engines: ["avatar_v", "avatar_iv", "avatar_iii"], preferred_orientation: "portrait", default_voice_id: "v-hi-f1" }],
      ["preset-raj", { id: "preset-raj", name: "Raj preset", avatar_type: "digital_twin", status: "completed", supported_api_engines: ["avatar_iii"], preferred_orientation: "portrait", default_voice_id: "v-hi-m1" }],
    ]),
    idempotent: new Map(),
    balance: 0,
    statusDown: false,
    seq: 0,
  };

  state.callsTo = (method, route) => state.calls.filter(call => call.method === method && call.path === route);
  state.finish = (videoId, extra = {}) => Object.assign(state.videos.get(videoId), { status: "completed", ...extra });
  state.fail = videoId =>
    Object.assign(state.videos.get(videoId), { status: "failed", failure_code: "render_error", failure_message: "internal detail" });
  state.finishLook = lookId => (state.looks.get(lookId).status = "completed");

  const server = https.createServer(selfSignedCert(dbDir), async (req, res) => {
    const url = new URL(req.url, base);
    const raw = await readBody(req);
    const contentType = req.headers["content-type"] || "";
    const json = contentType.includes("application/json") && raw.length ? JSON.parse(raw.toString()) : null;
    state.calls.push({ method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, body: json, rawLength: raw.length, contentType });

    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const error = (status, code, message) => send(status, { error: { code, message, request_id: "req_test" } });

    if (url.pathname.startsWith("/files/")) {
      res.writeHead(200, { "content-type": url.pathname.endsWith(".mp4") ? "video/mp4" : url.pathname.endsWith(".jpg") ? "image/jpeg" : "audio/mpeg" });
      return res.end(Buffer.from(`bytes:${url.pathname}`));
    }
    if (req.headers["x-api-key"] !== "test-key") return error(401, "unauthorized", "bad key");

    const route = `${req.method} ${url.pathname}`;
    let match;
    if ((match = url.pathname.match(/^\/v3\/avatars\/looks\/([^/]+)$/)) && req.method === "GET") {
      const look = state.looks.get(decodeURIComponent(match[1]));
      return look ? send(200, { data: look }) : error(404, "not_found", "no such look");
    }
    if (route === "GET /v3/avatars/looks") return send(200, { data: [], has_more: false });
    if (route === "GET /v3/voices") return send(200, { data: VOICES[url.searchParams.get("language")] || [], has_more: false });
    if (route === "GET /v3/users/me") return send(200, { data: { billing_type: "wallet", wallet: { currency: "usd", remaining_balance: state.balance } } });

    if (route === "POST /v3/videos") {
      const key = req.headers["idempotency-key"];
      if (key && state.idempotent.has(key)) return send(200, state.idempotent.get(key));
      if (/FAIL402/.test(json.script)) return error(402, "insufficient_credit", "Insufficient credits. Upgrade to continue.");
      if (/FAIL400/.test(json.script)) return error(400, "invalid_parameter", "script is invalid");
      const id = `vid_${++state.seq}`;
      state.videos.set(id, { id, status: "processing", title: json.title, duration: 4.2 });
      const reply = { data: { video_id: id, status: "pending", output_format: "mp4" } };
      if (key) state.idempotent.set(key, reply);
      return send(200, reply);
    }
    if ((match = url.pathname.match(/^\/v3\/videos\/([^/]+)$/)) && req.method === "GET") {
      if (state.statusDown) return error(500, "internal_error", "boom");
      const video = state.videos.get(match[1]);
      if (!video) return error(404, "not_found", "no such video");
      const done = video.status === "completed";
      return send(200, {
        data: {
          ...video,
          video_url: done ? `${base}/files/${video.id}.mp4` : null,
          captioned_video_url: done ? `${base}/files/${video.id}_cap.mp4` : null,
          thumbnail_url: done ? `${base}/files/${video.id}.jpg` : null,
        },
      });
    }
    if (route === "POST /v3/voices/speech") {
      if (/FAIL402/.test(json.text)) return error(402, "insufficient_credit", "Insufficient credits. Upgrade to continue.");
      return send(200, { data: { audio_url: `${base}/files/speech_${++state.seq}.mp3`, duration: 3.2, engine: "orca" } });
    }
    if (route === "POST /v3/assets") {
      if (!contentType.startsWith("multipart/form-data") || raw.length === 0) return error(400, "invalid_parameter", "file required");
      return send(200, { data: { asset_id: `asset_${++state.seq}`, url: `${base}/files/a.jpg`, mime_type: "image/jpeg", size_bytes: raw.length } });
    }
    if (route === "POST /v3/avatars") {
      const id = `look_${++state.seq}`;
      state.looks.set(id, { id, name: json.name, avatar_type: "photo_avatar", status: "processing", supported_api_engines: ["avatar_iv", "avatar_iii"], preferred_orientation: "portrait" });
      return send(200, { data: { avatar_item: state.looks.get(id), avatar_group: { id: `grp_${state.seq}`, name: json.name } } });
    }
    return error(404, "not_found", `unmocked ${route}`);
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  state.close = () => {
    server.closeAllConnections?.();
    return new Promise(resolve => server.close(resolve));
  };
  return state;
}

async function startMongod() {
  const port = await freePort();
  mongod = spawn("mongod", ["--dbpath", dbDir, "--port", String(port), "--bind_ip", "127.0.0.1", "--nounixsocket"], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mongod did not start in time")), 30000);
    mongod.stdout.on("data", chunk => {
      if (String(chunk).includes("Waiting for connections")) {
        clearTimeout(timer);
        resolve();
      }
    });
    mongod.on("exit", code => reject(new Error(`mongod exited early (${code})`)));
  });
  return `mongodb://127.0.0.1:${port}/aivideo_test`;
}

const userId = () => new mongoose.Types.ObjectId();
const studioOf = uid => Studio.findOne({ userId: uid });
const setCredits = (uid, credits) => Studio.updateOne({ userId: uid }, { $set: { credits } });
const videoIdOf = async (uid, projectId) => (await studioOf(uid)).projects.find(item => item.id === projectId).heygenVideoId;

before(async () => {
  if (!hasMongod) return;
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "aivideo-mongo-"));
  // The mock serves HTTPS with a throwaway certificate; the service only copies https links.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  mock = await startMockHeyGen();
  Object.assign(process.env, {
    HEYGEN_API_KEY: "test-key",
    HEYGEN_BASE_URL: mock.base,
    HEYGEN_AVATAR_PRIYA: "preset-priya",
    HEYGEN_AVATAR_RAJ: "preset-raj",
    AI_VIDEO_POLL_INTERVAL_MS: "0",
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.HEYGEN_RESOLUTION;

  const quiet = { info() {}, warn() {}, error() {}, debug() {} };
  const fake = (rel, exports) => {
    const file = require.resolve(rel);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  fake("../src/utils/logger", quiet);
  fake("../src/utils/spacesClient", {
    uploadBuffer: async (buffer, { folder, publicId }) => {
      if (stub.storageDown) throw new Error("storage is down");
      uploads.push({ folder, publicId, text: buffer.toString() });
      return { secure_url: `https://cdn.test/${folder}/${publicId}`, public_id: publicId, bytes: buffer.length };
    },
  });

  mongoose = require("mongoose");
  await mongoose.connect(await startMongod(), { serverSelectionTimeoutMS: 15000 });
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  await Studio.init();
  logic = require("../src/modules/aiVideo/aiVideo.logic");
  service = require("../src/modules/aiVideo/aiVideo.service");
});

after(async () => {
  if (!hasMongod) return;
  await mongoose.disconnect();
  mongod.removeAllListeners("exit");
  mongod.kill("SIGTERM");
  await mock.close();
  await new Promise(resolve => setTimeout(resolve, 300));
  fs.rmSync(dbDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
});

const opts = { skip: !hasMongod && "mongod is not installed" };

test("a new studio has the free credits, two stock presenters and no invented projects", opts, async () => {
  const uid = userId();
  const studio = service.present(await service.getStudio(uid, null));
  assert.equal(studio.credits, 120);
  assert.deepEqual(studio.projects, []);
  assert.deepEqual(studio.avatars.map(avatar => avatar.id), ["priya", "raj"]);
});

test("concurrent first requests create a single studio", opts, async () => {
  const uid = userId();
  await Promise.all([service.getStudio(uid, null), service.getStudio(uid, null), service.getStudio(uid, null)]);
  assert.equal(await Studio.countDocuments({ userId: uid }), 1);
});

test("a render is charged once, sent to HeyGen in a valid shape, and completes with a stored copy", opts, async () => {
  const uid = userId();
  const before = mock.callsTo("POST", "/v3/videos").length;
  const created = await service.createProject(uid, null, {
    title: "Festive sale",
    script: "Namaste! Festive sale hai aaj.",
    format: "9:16",
    presenter: "priya",
    voice: "priya",
    language: "hinglish",
    speed: "1.2x",
    captions: "bold",
  });
  assert.equal(created.credits, 100);
  assert.equal(created.project.status, "Rendering");
  assert.equal(created.project.videoUrl, null);

  const [call] = mock.callsTo("POST", "/v3/videos").slice(before);
  const body = call.body;
  assert.deepEqual(Object.keys(body).sort(), ["aspect_ratio", "avatar_id", "caption", "resolution", "script", "title", "type", "voice_id", "voice_settings"]);
  assert.equal(body.type, "avatar");
  assert.equal(body.avatar_id, "preset-priya");
  assert.equal(body.voice_id, "v-hi-f1");
  assert.equal(body.aspect_ratio, "9:16");
  assert.equal(body.resolution, "1080p");
  assert.deepEqual(body.voice_settings, { speed: 1.2 });
  assert.deepEqual(body.caption, { file_format: "srt", style: "default" });
  assert.equal(body.engine, undefined);
  assert.equal(call.headers["x-api-key"], "test-key");
  assert.ok(call.headers["idempotency-key"].endsWith(`:${created.project.id}`));

  const waiting = await service.getProject(uid, null, created.project.id);
  assert.equal(waiting.project.status, "Rendering");
  assert.ok(waiting.project.progress >= 3 && waiting.project.progress <= 95);
  assert.equal(waiting.project.videoUrl, null);

  mock.finish(await videoIdOf(uid, created.project.id));
  const done = await service.getProject(uid, null, created.project.id);
  assert.equal(done.project.status, "Completed");
  assert.equal(done.project.progress, 100);
  assert.equal(done.project.duration, "00:04");
  assert.match(done.project.videoUrl, new RegExp(`^https://cdn.test/AI-VIDEO/${uid}/${created.project.id}\\.mp4$`));
  assert.match(done.project.thumbnailUrl, /_thumb\.jpg$/);
  // Captions were burned in, so the captioned render is the one stored.
  assert.ok(uploads.some(item => item.publicId === `${created.project.id}.mp4` && item.text.includes("_cap.mp4")));
  assert.equal(done.credits, 100);
});

test("a presenter that needs a different engine is sent with it", opts, async () => {
  const uid = userId();
  const before = mock.callsTo("POST", "/v3/videos").length;
  await service.createProject(uid, null, { script: "Namaste doston, yeh ek test hai.", presenter: "raj", format: "16:9", captions: "off" });
  const body = mock.callsTo("POST", "/v3/videos")[before].body;
  assert.equal(body.avatar_id, "preset-raj");
  assert.deepEqual(body.engine, { type: "avatar_iii" });
  assert.equal(body.aspect_ratio, "16:9");
  assert.equal(body.caption, undefined);
  assert.equal(body.voice_id, "v-hi-f1");
});

test("a render that fails at the provider is refunded exactly once", opts, async () => {
  const uid = userId();
  const created = await service.createProject(uid, null, { script: "RENDERFAIL please", presenter: "priya" });
  assert.equal(created.credits, 100);
  mock.fail(await videoIdOf(uid, created.project.id));
  for (let i = 0; i < 3; i++) {
    const { project, credits } = await service.getProject(uid, null, created.project.id);
    assert.equal(project.status, "Draft");
    assert.equal(project.failed, true);
    assert.match(project.error, /credits were returned/);
    assert.doesNotMatch(project.error, /internal detail/);
    assert.equal(credits, 120);
  }
  assert.equal((await studioOf(uid)).credits, 120);
});

test("a provider billing rejection charges nothing and is not shown to customers", opts, async () => {
  const uid = userId();
  await assert.rejects(
    service.createProject(uid, null, { script: "FAIL402 now", presenter: "priya" }),
    error => {
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /credit|balance|402|insufficient|upgrade/i);
      return true;
    },
  );
  const studio = await studioOf(uid);
  assert.equal(studio.credits, 120);
  assert.equal(studio.projects.length, 0);

  await assert.rejects(service.createProject(uid, null, { script: "FAIL400 now", presenter: "priya" }), error => {
    assert.equal(error.status, 400);
    assert.match(error.message, /script is invalid/);
    return true;
  });
  assert.equal((await studioOf(uid)).credits, 120);
});

test("three simultaneous taps with credits for one video create exactly one render", opts, async () => {
  const uid = userId();
  await service.getStudio(uid, null);
  await setCredits(uid, 20);
  const before = mock.callsTo("POST", "/v3/videos").length;
  const results = await Promise.allSettled(
    [1, 2, 3].map(n => service.createProject(uid, null, { script: `Tap number ${n} for a real test`, presenter: "priya" })),
  );
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  for (const r of results.filter(r => r.status === "rejected")) {
    assert.equal(r.reason.status, 400);
    assert.match(r.reason.message, /need 20 credits/);
  }
  const studio = await studioOf(uid);
  assert.equal(studio.credits, 0);
  assert.equal(studio.projects.length, 1);
  assert.equal(mock.callsTo("POST", "/v3/videos").length - before, 1);
});

test("parallel renders per user are capped", opts, async () => {
  const uid = userId();
  await service.getStudio(uid, null);
  await setCredits(uid, 500);
  for (let i = 0; i < logic.MAX_CONCURRENT_RENDERS; i++) {
    await service.createProject(uid, null, { script: `Parallel render number ${i} for the cap test`, presenter: "priya" });
  }
  await assert.rejects(
    service.createProject(uid, null, { script: "One more than allowed for the cap test", presenter: "priya" }),
    error => error.status === 400 && /already have videos rendering/.test(error.message),
  );
});

test("a render stuck for too long is failed and refunded", opts, async () => {
  const uid = userId();
  const created = await service.createProject(uid, null, { script: "This render will never finish properly", presenter: "priya" });
  await Studio.updateOne(
    { userId: uid, "projects.id": created.project.id },
    { $set: { "projects.$.renderStartedAt": new Date(Date.now() - 50 * 60 * 1000) } },
  );
  const { project, credits } = await service.getProject(uid, null, created.project.id);
  assert.equal(project.failed, true);
  assert.equal(credits, 120);
});

test("a provider outage while polling does not fail a render that is still running", opts, async () => {
  const uid = userId();
  const created = await service.createProject(uid, null, { script: "Provider status checks will hiccup here", presenter: "priya" });
  mock.statusDown = true;
  const during = await service.getProject(uid, null, created.project.id);
  mock.statusDown = false;
  assert.equal(during.project.status, "Rendering");
  assert.equal(during.credits, 100);
  mock.finish(await videoIdOf(uid, created.project.id));
  assert.equal((await service.getProject(uid, null, created.project.id)).project.status, "Completed");
});

test("without a provider key nothing is charged", opts, async () => {
  const uid = userId();
  const key = process.env.HEYGEN_API_KEY;
  delete process.env.HEYGEN_API_KEY;
  try {
    await assert.rejects(service.createProject(uid, null, { script: "No key is configured on this server", presenter: "priya" }), error => error.status === 503);
    assert.equal((await service.providerStatus()).configured, false);
  } finally {
    process.env.HEYGEN_API_KEY = key;
  }
  assert.equal((await studioOf(uid))?.credits ?? 120, 120);
});

test("a finished video keeps working after provider links expire when storage was down", opts, async () => {
  const uid = userId();
  const created = await service.createProject(uid, null, { script: "Storage is down when this one finishes", presenter: "priya", captions: "off" });
  stub.storageDown = true;
  mock.finish(await videoIdOf(uid, created.project.id));
  const first = (await service.getProject(uid, null, created.project.id)).project;
  stub.storageDown = false;
  assert.equal(first.status, "Completed");
  assert.match(first.videoUrl, /^https:\/\/127\.0\.0\.1:\d+\/files\/vid_\d+\.mp4$/);

  await Studio.updateOne(
    { userId: uid, "projects.id": created.project.id },
    { $set: { "projects.$.providerUrlAt": new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) } },
  );
  const refreshed = (await service.getProject(uid, null, created.project.id)).project;
  assert.match(refreshed.videoUrl, /^https:\/\/cdn\.test\//);
});

test("voiceover charges once, returns a stored audio url, and refunds on provider failure", opts, async () => {
  const uid = userId();
  const made = await service.createVoiceover(uid, null, { script: "Namaste doston", voice: "aarav", language: "english", speed: "0.8x" });
  assert.equal(made.credits, 112);
  assert.match(made.voiceover.audioUrl, /^https:\/\/cdn\.test\/AI-VIDEO\/.+\/voiceovers\/.+\.mp3$/);
  const call = mock.callsTo("POST", "/v3/voices/speech").pop();
  assert.equal(call.body.voice_id, "v-en-m1");
  assert.equal(call.body.speed, 0.8);

  await assert.rejects(service.createVoiceover(uid, null, { script: "FAIL402 speech", voice: "priya" }), error => error.status === 503);
  assert.equal((await studioOf(uid)).credits, 112);
  await assert.rejects(service.createVoiceover(uid, null, { script: "  " }), error => error.status === 400);
});

test("a voice sample is free: it comes from the catalog without synthesizing speech", opts, async () => {
  const before = mock.callsTo("POST", "/v3/voices/speech").length;
  const sample = await service.voicePreview({ voice: "aarav", language: "english" });
  assert.equal(sample.previewUrl, "https://samples.test/v-en-m1.mp3");
  assert.equal(mock.callsTo("POST", "/v3/voices/speech").length, before);
  const hindi = await service.voicePreview({ voice: "priya", language: "hinglish" });
  assert.equal(hindi.previewUrl, "https://samples.test/v-hi-f1.mp3");
});

test("photo avatars are created on HeyGen, tracked until ready, then usable as a presenter", opts, async () => {
  const uid = userId();
  const file = { buffer: Buffer.from("fake-jpeg-bytes"), originalname: "me.jpg", mimetype: "image/jpeg" };
  const { avatar } = await service.saveAvatar(uid, null, { name: "Founder" }, file);
  assert.equal(avatar.status, "Processing");
  assert.ok(!("heygenLookId" in avatar));

  const upload = mock.callsTo("POST", "/v3/assets").pop();
  assert.match(upload.contentType, /^multipart\/form-data/);
  const create = mock.callsTo("POST", "/v3/avatars").pop();
  const lookId = [...mock.looks.keys()].pop();
  assert.equal(create.body.type, "photo");
  assert.equal(create.body.name, "Founder");
  assert.equal(create.body.file.type, "asset_id");

  await assert.rejects(
    service.createProject(uid, null, { script: "Using an avatar that is not ready yet", presenter: avatar.id }),
    error => error.status === 400 && /still being created/.test(error.message),
  );
  assert.equal((await service.getAvatar(uid, null, avatar.id)).avatar.status, "Processing");

  mock.finishLook(lookId);
  assert.equal((await service.getAvatar(uid, null, avatar.id)).avatar.status, "Ready");

  const before = mock.callsTo("POST", "/v3/videos").length;
  await service.createProject(uid, null, { script: "Now the founder avatar presents this", presenter: avatar.id });
  assert.equal(mock.callsTo("POST", "/v3/videos")[before].body.avatar_id, lookId);

  // The client can rename an avatar but never mark it ready.
  const edited = await service.updateAvatar(uid, null, avatar.id, { name: "CEO", status: "Failed" });
  assert.equal(edited.avatar.name, "CEO");
  assert.equal(edited.avatar.status, "Ready");
});

test("avatar creation needs a photo and is capped per studio", opts, async () => {
  const uid = userId();
  await assert.rejects(service.saveAvatar(uid, null, { name: "No photo" }, undefined), error => error.status === 400);
  const file = { buffer: Buffer.from("x"), originalname: "a.png", mimetype: "image/png" };
  for (let i = 0; i < 5; i++) await service.saveAvatar(uid, null, { name: `A${i}` }, file);
  await assert.rejects(service.saveAvatar(uid, null, { name: "Sixth" }, file), error => error.status === 400 && /up to 5/.test(error.message));
});

test("a rendering video cannot be deleted, a finished one can", opts, async () => {
  const uid = userId();
  const created = await service.createProject(uid, null, { script: "Delete rules are checked with this one", presenter: "priya" });
  await assert.rejects(service.deleteProject(uid, null, created.project.id), error => error.status === 400);
  mock.finish(await videoIdOf(uid, created.project.id));
  await service.getProject(uid, null, created.project.id);
  assert.deepEqual(await service.deleteProject(uid, null, created.project.id), { deleted: true });
  await assert.rejects(service.getProject(uid, null, created.project.id), error => error.status === 404);
});

test("scripts fall back to the template without OpenAI, are length-checked, and are rate limited", opts, async () => {
  const uid = userId();
  const written = await service.writeScript(uid, { topic: "Diwali sale", language: "english" });
  assert.equal(written.source, "template");
  assert.match(written.script, /Diwali sale/);
  await assert.rejects(
    service.createProject(uid, null, { script: "x ".repeat(700), presenter: "priya" }),
    error => error.status === 400 && /under 1200 characters/.test(error.message),
  );
  let blocked;
  for (let i = 0; i < 31; i++) {
    try {
      await service.writeScript(uid, { topic: `Topic ${i}` });
    } catch (error) {
      blocked = error;
    }
  }
  assert.equal(blocked?.status, 400);
});

test("the admin status check reports whether the HeyGen wallet can render", opts, async () => {
  mock.balance = 0;
  const empty = await service.providerStatus();
  assert.equal(empty.ok, true);
  assert.equal(empty.canRender, false);
  mock.balance = 12.5;
  const funded = await service.providerStatus();
  assert.equal(funded.canRender, true);
  assert.equal(funded.remainingBalance, 12.5);
});

test("the HeyGen key never appears in errors the client can see", opts, async () => {
  const { HeyGenError, getVideo } = require("../src/modules/aiVideo/heygen.client");
  process.env.HEYGEN_BASE_URL = "http://127.0.0.1:1";
  try {
    await getVideo("anything");
    assert.fail("expected a network error");
  } catch (error) {
    assert.ok(error instanceof HeyGenError);
    assert.equal(error.code, "network_error");
    assert.ok(!JSON.stringify(error).includes("test-key") && !String(error.stack).includes("test-key"));
  } finally {
    process.env.HEYGEN_BASE_URL = mock.base;
  }
});
