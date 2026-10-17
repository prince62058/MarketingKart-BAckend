// Shared test infrastructure for the AI video module: a throwaway local mongod (never the database
// in .env) and an HTTPS mock of HeyGen's v3 API shaped from its published OpenAPI spec.
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const hasMongod = spawnSync("mongod", ["--version"]).status === 0;

const freePort = () =>
  new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

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

function selfSignedCert(dir) {
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
  if (made.status !== 0) throw new Error(`openssl failed: ${made.stderr}`);
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

async function startMockHeyGen(workDir) {
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
    groups: new Map(),
    assets: new Map(),
    idempotent: new Map(),
    balance: 0,
    statusDown: false,
    seq: 0,
  };

  state.callsTo = (method, route) => state.calls.filter(call => call.method === method && call.path === route);
  state.finish = (videoId, extra = {}) => Object.assign(state.videos.get(videoId), { status: "completed", ...extra });
  state.fail = videoId => Object.assign(state.videos.get(videoId), { status: "failed", failure_code: "render_error", failure_message: "internal detail" });
  state.finishLook = lookId => (state.looks.get(lookId).status = "completed");
  state.failLook = (lookId, code = "training_failed") => {
    const look = state.looks.get(lookId);
    look.status = "failed";
    look.error = { code, message: "internal training detail" };
  };
  state.setConsent = (groupId, value) => (state.groups.get(groupId).consent_status = value);

  const server = https.createServer(selfSignedCert(workDir), async (req, res) => {
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
    let match;
    // Presigned storage endpoint: no API key, just the bytes.
    if ((match = url.pathname.match(/^\/upload\/([^/]+)$/)) && req.method === "PUT") {
      const asset = state.assets.get(match[1]);
      if (!asset) return error(404, "not_found", "no such upload");
      if (raw.length !== asset.size_bytes) return error(403, "size_mismatch", "size does not match the signed size");
      asset.uploaded = true;
      return send(200, {});
    }
    if (req.headers["x-api-key"] !== "test-key") return error(401, "unauthorized", "bad key");

    const route = `${req.method} ${url.pathname}`;
    if ((match = url.pathname.match(/^\/v3\/avatars\/looks\/([^/]+)$/)) && req.method === "GET") {
      const look = state.looks.get(decodeURIComponent(match[1]));
      return look ? send(200, { data: look }) : error(404, "not_found", "no such look");
    }
    if (route === "GET /v3/avatars/looks") return send(200, { data: [], has_more: false });
    if ((match = url.pathname.match(/^\/v3\/avatars\/([^/]+)\/consent$/)) && req.method === "POST") {
      const group = state.groups.get(match[1]);
      if (!group) return error(404, "not_found", "no such avatar group");
      if (group.consent_status !== "accepted") group.consent_status = "pending";
      return send(200, { data: { avatar_group: group, url: `${base}/consent/${group.id}` } });
    }
    if ((match = url.pathname.match(/^\/v3\/avatars\/([^/]+)$/))) {
      const group = state.groups.get(match[1]);
      if (req.method === "GET") return group ? send(200, { data: group }) : error(404, "not_found", "no such avatar group");
      if (req.method === "DELETE") {
        if (!group) return error(404, "not_found", "no such avatar group");
        state.groups.delete(group.id);
        for (const [id, look] of state.looks) if (look.group_id === group.id) state.looks.delete(id);
        return send(200, { data: { id: group.id } });
      }
    }
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
      const id = `asset_${++state.seq}`;
      state.assets.set(id, { id, size_bytes: raw.length, uploaded: true, completed: true });
      return send(200, { data: { asset_id: id, url: `${base}/files/a.jpg`, mime_type: "image/jpeg", size_bytes: raw.length } });
    }
    if (route === "POST /v3/assets/direct-uploads") {
      if (!json.filename || !json.content_type || !Number.isInteger(json.size_bytes)) return error(400, "invalid_parameter", "filename, content_type and size_bytes are required");
      const id = `asset_${++state.seq}`;
      state.assets.set(id, { id, size_bytes: json.size_bytes, content_type: json.content_type, uploaded: false, completed: false });
      return send(200, {
        data: { asset_id: id, upload_url: `${base}/upload/${id}`, upload_headers: { "Content-Type": json.content_type }, expires_in_seconds: 3600, max_bytes: 209715200, status: "pending_upload" },
      });
    }
    if ((match = url.pathname.match(/^\/v3\/assets\/([^/]+)\/complete$/)) && req.method === "POST") {
      const asset = state.assets.get(match[1]);
      if (!asset) return error(404, "not_found", "no such asset");
      if (!asset.uploaded) return error(400, "upload_missing", "the file has not been uploaded yet");
      asset.completed = true;
      return send(200, { data: { asset_id: asset.id, url: `${base}/files/footage.mp4`, mime_type: asset.content_type, size_bytes: asset.size_bytes, status: "processing" } });
    }
    if (route === "POST /v3/avatars") {
      if (/BADFOOTAGE/.test(json.name)) return error(400, "invalid_parameter", "No face was detected in the footage");
      if (json.type === "digital_twin" && !(json.file && state.assets.get(json.file.asset_id) && state.assets.get(json.file.asset_id).completed)) {
        return error(400, "invalid_parameter", "the footage asset is not ready");
      }
      const n = ++state.seq;
      const look = {
        id: `look_${n}`, name: json.name, group_id: `grp_${n}`, avatar_type: json.type === "photo" ? "photo_avatar" : "digital_twin", status: "processing",
        supported_api_engines: ["avatar_iv", "avatar_iii"], preferred_orientation: "portrait", default_voice_id: json.type === "digital_twin" ? `voice_clone_${n}` : undefined,
        preview_image_url: `${base}/files/p${n}.jpg`, preview_video_url: json.type === "digital_twin" ? `${base}/files/p${n}.mp4` : undefined,
      };
      const group = { id: `grp_${n}`, name: json.name, looks_count: 1, created_at: 1, consent_status: json.type === "digital_twin" ? null : undefined, default_voice_id: look.default_voice_id };
      state.looks.set(look.id, look);
      state.groups.set(group.id, group);
      return send(200, { data: { avatar_item: look, avatar_group: group } });
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

// Test files run in parallel, so a port that was free a moment ago can be taken by another file's
// mongod. When that happens mongod exits straight away; try again on a fresh port.
async function startMongod(dir) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await startMongodOnce(dir);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function startMongodOnce(dir) {
  const port = await freePort();
  const mongod = spawn("mongod", ["--dbpath", dir, "--port", String(port), "--bind_ip", "127.0.0.1", "--nounixsocket"], { stdio: ["ignore", "pipe", "pipe"] });
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
  return { mongod, uri: `mongodb://127.0.0.1:${port}/aivideo_test` };
}

// Boots mongod + the HeyGen mock, points the module at them, and silences logging and storage.
async function bootHarness({ spaces } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aivideo-test-"));
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const mock = await startMockHeyGen(dir);
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
    const file = require.resolve(path.join(__dirname, "..", rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  fake("../src/utils/logger", quiet);
  const uploads = [];
  const storage = { down: false };
  fake("../src/utils/spacesClient", {
    uploadBuffer: async (buffer, { folder, publicId }) => {
      if (storage.down) throw new Error("storage is down");
      uploads.push({ folder, publicId, text: buffer.toString() });
      return { secure_url: `https://cdn.test/${folder}/${publicId}`, public_id: publicId, bytes: buffer.length };
    },
    ...(spaces || {}),
  });

  const mongoose = require(path.join(__dirname, "..", "..", "node_modules", "mongoose"));
  const { mongod, uri } = await startMongod(dir);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

  return {
    mock,
    mongoose,
    uploads,
    storage,
    async close() {
      await mongoose.disconnect();
      mongod.removeAllListeners("exit");
      // Wait for mongod to really stop, or it is still writing while the folder is deleted.
      const stopped = new Promise(resolve => mongod.once("exit", resolve));
      mongod.kill("SIGTERM");
      await mock.close();
      await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 8000))]);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    },
  };
}

// Sends raw bytes the way the phone does: a PUT straight to the presigned url.
function putBytes(upload, bytes) {
  return new Promise((resolve, reject) => {
    const target = new URL(upload.url);
    const req = https.request(
      { method: "PUT", hostname: target.hostname, port: target.port, path: target.pathname, headers: { ...upload.headers, "Content-Length": bytes.length }, rejectUnauthorized: false },
      res => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end(bytes);
  });
}

module.exports = { hasMongod, bootHarness, putBytes };
