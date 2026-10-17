// The copy step that keeps finished videos after the provider's links expire. Needs no database:
// a local HTTPS server stands in for the provider's file host and the storage upload is recorded.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;
const uploads = [];
let server;
let base;
let dir;
let storage;

const freePort = () =>
  new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

before(async () => {
  if (!hasOpenssl) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aivideo-storage-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
  if (made.status !== 0) throw new Error(`openssl failed: ${made.stderr}`);
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const fake = (rel, exports) => {
    const file = require.resolve(rel);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  fake("../src/utils/logger", { info() {}, warn() {}, error() {}, debug() {} });
  fake("../src/utils/spacesClient", {
    uploadBuffer: async (buffer, options) => {
      uploads.push({ ...options, bytes: buffer.length });
      return { secure_url: `https://cdn.test/${options.folder}/${options.publicId}` };
    },
  });
  storage = require("../src/modules/aiVideo/aiVideo.storage");

  // `type` is what the "provider" claims; HeyGen's real host answers `binary/octet-stream`.
  const types = { "/video.mp4": "binary/octet-stream", "/thumb.jpg": "binary/octet-stream", "/plain.mp4": "video/mp4", "/legacy.mp4": "application/octet-stream", "/none.mp3": undefined };
  server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    if (!(req.url in types)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, types[req.url] ? { "content-type": types[req.url] } : {});
    res.end(Buffer.from("0123456789"));
  });
  const port = await freePort();
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  base = `https://127.0.0.1:${port}`;
});

after(async () => {
  if (!hasOpenssl) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const opts = { skip: !hasOpenssl && "openssl is not installed" };
const copy = (route, extra) => storage.mirror(`${base}${route}`, { folder: "AI-VIDEO/u1", name: "p1", ...extra });

test("a file labelled binary/octet-stream is stored with the type we know it has", opts, async () => {
  uploads.length = 0;
  assert.equal(await copy("/video.mp4", { fallbackMimetype: "video/mp4" }), "https://cdn.test/AI-VIDEO/u1/p1.mp4");
  assert.equal(await copy("/thumb.jpg", { name: "p1_thumb", fallbackMimetype: "image/jpeg" }), "https://cdn.test/AI-VIDEO/u1/p1_thumb.jpg");
  assert.deepEqual(uploads.map(item => [item.publicId, item.mimetype, item.bytes]), [["p1.mp4", "video/mp4", 10], ["p1_thumb.jpg", "image/jpeg", 10]]);
});

test("application/octet-stream and a missing type are treated the same way", opts, async () => {
  uploads.length = 0;
  await copy("/legacy.mp4", { fallbackMimetype: "video/mp4" });
  await copy("/none.mp3", { fallbackMimetype: "audio/mpeg" });
  assert.deepEqual(uploads.map(item => [item.publicId, item.mimetype]), [["p1.mp4", "video/mp4"], ["p1.mp3", "audio/mpeg"]]);
});

test("a type the provider states clearly is kept", opts, async () => {
  uploads.length = 0;
  await copy("/plain.mp4", { fallbackMimetype: "image/jpeg" });
  assert.deepEqual(uploads.map(item => [item.publicId, item.mimetype]), [["p1.mp4", "video/mp4"]]);
});

test("a failed download or unusable link keeps the provider link instead of throwing", opts, async () => {
  uploads.length = 0;
  assert.equal(await copy("/missing", { fallbackMimetype: "video/mp4" }), null);
  assert.equal(await storage.mirror("http://not-https.test/x.mp4", { folder: "f", name: "n" }), null);
  assert.equal(await storage.mirror(null, { folder: "f", name: "n" }), null);
  assert.equal(uploads.length, 0);
});
