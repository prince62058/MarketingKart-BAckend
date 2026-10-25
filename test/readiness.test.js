const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkReadiness, readinessHandler } = require("../src/utils/readiness");

const up = () => Promise.resolve("up");
const down = () => Promise.resolve("down");
const broken = () => Promise.reject(new Error("connection refused"));
const skipped = () => Promise.resolve("skipped");

const respond = async deps => {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await readinessHandler(deps)({}, res);
  return res;
};

test("ready when the database and Redis answer", async () => {
  assert.deepEqual(await checkReadiness({ mongo: up, redis: up }), { ok: true, checks: { mongo: "up", redis: "up" } });
});

test("not ready when the database is down, even if Redis is fine", async () => {
  const { ok, checks } = await checkReadiness({ mongo: down, redis: up });
  assert.equal(ok, false);
  assert.equal(checks.mongo, "down");
});

test("a check that throws counts as down and never throws out of the handler", async () => {
  const res = await respond({ mongo: up, redis: broken });
  assert.equal(res.code, 503);
  assert.equal(res.body.status, "unavailable");
  assert.deepEqual(res.body.checks, { mongo: "up", redis: "down" });
});

test("Redis that is not configured is skipped, not a failure", async () => {
  const res = await respond({ mongo: up, redis: skipped });
  assert.equal(res.code, 200);
  assert.equal(res.body.status, "ok");
  assert.equal(res.body.checks.redis, "skipped");
  assert.equal(typeof res.body.uptimeSeconds, "number");
});

test("the real database check reports down when there is no connection", async () => {
  // No mongoose connection exists in this test process, and Redis is not configured here.
  delete process.env.REDIS_URL;
  delete process.env.REDIS_HOST;
  const result = await checkReadiness();
  assert.equal(result.checks.mongo, "down");
  assert.equal(result.checks.redis, "skipped");
  assert.equal(result.ok, false);
});
