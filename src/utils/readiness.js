// Is this instance able to serve traffic? Used by GET /healthz, so a load balancer or the deploy
// platform can stop sending requests to an instance whose database or Redis is gone, instead of
// the old "/" page that answers 200 as long as the process is alive.
const mongoose = require("mongoose");

const PING_TIMEOUT_MS = 2000;

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

// One small connection reserved for PING, created the first time it is needed.
let redisProbe = null;
function pingRedis() {
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) return Promise.resolve("skipped");
  if (!redisProbe) {
    const Redis = require("ioredis");
    const options = { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: PING_TIMEOUT_MS };
    redisProbe = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, options)
      : new Redis({
          host: process.env.REDIS_HOST,
          port: parseInt(process.env.REDIS_PORT, 10) || 6379,
          ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
          ...options,
        });
    redisProbe.on("error", () => {});
  }
  return withTimeout(
    redisProbe.status === "wait" ? redisProbe.connect().then(() => redisProbe.ping()) : redisProbe.ping(),
    PING_TIMEOUT_MS,
  ).then(() => "up");
}

const pingMongo = () =>
  mongoose.connection.readyState === 1
    ? withTimeout(mongoose.connection.db.admin().ping(), PING_TIMEOUT_MS).then(() => "up")
    : Promise.resolve("down");

/** Resolves to { ok, checks: { mongo, redis } } with each check "up", "down" or "skipped". */
async function checkReadiness({ mongo = pingMongo, redis = pingRedis } = {}) {
  const settle = probe => probe().catch(() => "down");
  const [mongoState, redisState] = await Promise.all([settle(mongo), settle(redis)]);
  const checks = { mongo: mongoState, redis: redisState };
  return { ok: Object.values(checks).every(state => state !== "down"), checks };
}

const readinessHandler = deps => async (req, res) => {
  const { ok, checks } = await checkReadiness(deps);
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "unavailable", checks, uptimeSeconds: Math.round(process.uptime()) });
};

module.exports = { checkReadiness, readinessHandler };
