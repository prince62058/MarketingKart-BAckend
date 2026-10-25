// Shared setup for the security tests: the real Express app, the real routes, controllers and models,
// against a throwaway local mongod. It never reads the .env (which points at the production database
// and Redis) and never opens a Redis connection or a scheduled job.
//
// Skipped when `mongod` is not installed.
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..", "..");
const hasMongod = spawnSync("mongod", ["--version"]).status === 0;

const freePort = () =>
  new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// Replace a module with a fake before anything requires it.
const fake = (id, exports) => {
  const file = require.resolve(id, { paths: [root] });
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

function stubSideEffects() {
  const quiet = { info() {}, warn() {}, error() {}, debug() {} };
  // multer.js and others load ../../.env at require time. Never let that happen here.
  fake("dotenv", { config: () => ({ parsed: {} }) });
  // Cron jobs would keep the test process alive.
  fake("node-cron", { schedule: () => ({ start() {}, stop() {} }) });
  fake("cron", { CronJob: class { start() {} stop() {} } });
  fake(path.join(root, "src/utils/logger"), quiet);
  fake(path.join(root, "src/utils/spacesClient"), {
    uploadBuffer: async (buffer, { folder, publicId }) => ({ secure_url: `https://cdn.test/${folder}/${publicId}`, public_id: publicId, bytes: buffer.length }),
    deleteByUrl: async () => {},
  });
  // No Redis, ever: the WhatsApp queue is the only thing that opens a connection.
  const inertRedis = { on() {}, duplicate() { return this; }, disconnect() {}, quit() {} };
  fake(path.join(root, "src/config/redisConfig"), { createRedisConnection: () => inertRedis });
  fake("bullmq", {
    Queue: class { on() {} async add() { return { id: "test-job" }; } async close() {} },
    Worker: class { on() {} async close() {} },
  });
  // No real SMS or e-mail: capture them so a test can read the OTP the way a customer would.
  const sent = { sms: [], mail: [] };
  fake(path.join(root, "src/helpers/sendOtpHelper"), {
    sendOtp: (mobile, otp) => {
      sent.sms.push({ mobile: String(mobile), otp: String(otp) });
    },
    sendOtpInMail: (email, otp) => {
      sent.mail.push({ email, otp: String(otp) });
    },
  });
  return sent;
}

async function startMongod(dir, { replSet = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const port = await freePort();
    const args = ["--dbpath", dir, "--port", String(port), "--bind_ip", "127.0.0.1", "--nounixsocket"];
    if (replSet) args.push("--replSet", "rs0");
    const mongod = spawn("mongod", args, { stdio: ["ignore", "pipe", "pipe"] });
    try {
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
      return { mongod, port };
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

async function initiateReplicaSet(port) {
  const { MongoClient } = require(path.join(root, "node_modules", "mongoose")).mongo;
  const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`);
  await client.connect();
  await client.db("admin").command({ replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
  for (let i = 0; i < 60; i += 1) {
    const hello = await client.db("admin").command({ hello: 1 });
    if (hello.isWritablePrimary) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await client.close();
}

/**
 * Boots mongod, connects mongoose, and (unless `app: false`) loads the real src/app.js behind an HTTP
 * server. `replSet` is needed by code that uses MongoDB transactions (wallet credits, staff creation).
 */
async function bootSecurityHarness({ replSet = false, app: withApp = true, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "security-test-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    JWT_SECRET: "security-test-secret",
    RAZORPAY_KEY_ID: "rzp_test_unit",
    RAZORPAY_KEY_SECRET: "unit_test_secret",
    ...env,
  });
  delete process.env.OTP_TEST_ACCOUNTS;
  delete process.env.TOKEN_KEY;
  const sent = stubSideEffects();

  const { mongod, port } = await startMongod(dir, { replSet });
  if (replSet) await initiateReplicaSet(port);
  const mongoose = require(path.join(root, "node_modules", "mongoose"));
  const uri = replSet
    ? `mongodb://127.0.0.1:${port}/security_test?replicaSet=rs0&directConnection=true`
    : `mongodb://127.0.0.1:${port}/security_test`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

  let server = null;
  let base = null;
  if (withApp) {
    const app = require(path.join(root, "src", "app"));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }

  return {
    mongoose,
    sent,
    base,
    server,
    root,
    /** Calls the running app. `token` becomes the bearer header; `body` is sent as JSON. */
    async call(method, route, { token, body, headers = {} } = {}) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {}
      return { status: response.status, body: json, text };
    },
    async close() {
      if (server) {
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
      }
      await mongoose.disconnect();
      mongod.removeAllListeners("exit");
      const stopped = new Promise(resolve => mongod.once("exit", resolve));
      mongod.kill("SIGTERM");
      await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 8000))]);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    },
  };
}

module.exports = { hasMongod, bootSecurityHarness, freePort, fake };
