const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { hasMongod, bootHarness } = require("./helpers/aiVideoHarness");

let h;
let Studio;
let User;
let logic;
let admin;
let settings;
let catalog;
let server;
let baseUrl;
let tokens;
let ids;
const opts = { skip: !hasMongod && "mongod is not installed" };

const minutesAgo = n => new Date(Date.now() - n * 60 * 1000);
const adminActor = () => ({ _id: ids.admin, name: "Admin One" });

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body && !["GET", "HEAD"].includes(method) ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

before(async () => {
  if (!hasMongod) return;
  process.env.JWT_SECRET = "admin-test-secret";
  h = await bootHarness();
  const mongoose = h.mongoose;
  const express = require("../node_modules/express");
  const jwt = require("../node_modules/jsonwebtoken");
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  User = require("../src/models/userModel");
  logic = require("../src/modules/aiVideo/aiVideo.logic");
  admin = require("../src/modules/aiVideo/aiVideo.admin.service");
  settings = require("../src/modules/aiVideo/aiVideo.settings");
  catalog = require("../src/modules/aiVideo/heygen.catalog");
  await Promise.all([Studio.init(), User.init()]);

  const [adminUser, alice, bob] = await User.create([
    { name: "Admin One", mobile: 9876500000, email: "admin@example.test", userType: "ADMIN" },
    { name: "Alice Sharma", mobile: 9876500001, email: "alice@example.test", userType: "USER" },
    { name: "Bob Verma", mobile: 9876500002, email: "bob@example.test", userType: "USER" },
  ]);
  tokens = {
    admin: jwt.sign({ User: String(adminUser._id) }, process.env.JWT_SECRET),
    alice: jwt.sign({ User: String(alice._id) }, process.env.JWT_SECRET),
  };

  // Alice has a busy studio; Bob has a small one.
  h.mock.groups.set("grp_twin", { id: "grp_twin", name: "Alice Twin", consent_status: "pending" });
  const studioA = await Studio.create({
    userId: alice._id,
    businessId: "biz-alice",
    credits: 80,
    plan: "pro",
    avatars: [
      ...logic.seedAvatars(),
      { id: "av-photo", name: "Alice Photo", kind: "photo", status: "Ready", heygenLookId: "look_p", createdAt: minutesAgo(500) },
      { id: "av-twin", name: "Alice Twin", kind: "clone", status: "Consent needed", consentStatus: "pending", heygenGroupId: "grp_twin", heygenLookId: "look_t", cost: 0, createdAt: minutesAgo(400) },
    ],
    projects: [
      { id: "a1", title: "Diwali Sale", status: "Completed", cost: 20, durationSeconds: 30, duration: "00:30", script: "Diwali sale: ".padEnd(900, "x"), heygenVideoId: "vid_a1", videoUrl: "https://cdn.test/a1.mp4", thumbnailUrl: "https://cdn.test/a1.jpg", renderStartedAt: minutesAgo(30), completedAt: minutesAgo(28), createdAt: minutesAgo(30), format: "9:16", presenter: "priya" },
      { id: "a2", title: "Broken render", status: "Failed", cost: 20, refunded: true, error: "We could not generate this video, so your credits were returned.", createdAt: minutesAgo(20), format: "9:16", presenter: "priya" },
      { id: "a3", title: "Still going", status: "Rendering", cost: 20, renderStartedAt: minutesAgo(1), createdAt: minutesAgo(1), format: "16:9", presenter: "raj" },
    ],
    voiceovers: [{ id: "vo1", script: "hello", status: "ready", cost: 8 }],
    orders: [
      { id: "o1", kind: "pack", itemId: "pack_100", price: 299, credits: 100, status: "paid", method: "razorpay", razorpayOrderId: "order_A", razorpayPaymentId: "pay_A", paidAt: minutesAgo(100), createdAt: minutesAgo(110) },
      { id: "o2", kind: "plan", itemId: "pro", billing: "monthly", price: 499, credits: 1000, status: "pending_payment", method: "razorpay", razorpayOrderId: "order_B", createdAt: minutesAgo(5) },
    ],
    enterprise: { name: "Alice Sharma", phone: "9876500001", company: "Alice Fashions", status: "requested" },
  });
  const studioB = await Studio.create({
    userId: bob._id,
    businessId: "biz-bob",
    credits: 20,
    avatars: logic.seedAvatars(),
    projects: [{ id: "b1", title: "Bob promo", status: "Completed", cost: 20, durationSeconds: 12, renderStartedAt: minutesAgo(15), completedAt: minutesAgo(14), createdAt: minutesAgo(15), format: "9:16", presenter: "raj" }],
  });
  ids = { admin: adminUser._id, alice: alice._id, bob: bob._id, studioA: String(studioA._id), studioB: String(studioB._id) };

  const app = express();
  app.use(express.json());
  app.use("/api", require("../src/modules/aiVideo/aiVideo.admin.routes"));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (!hasMongod) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await h.close();
});

test("every admin route refuses anonymous callers and ordinary signed-in users", opts, async () => {
  const router = require("../src/modules/aiVideo/aiVideo.admin.routes");
  const routes = router.stack.filter(layer => layer.route).map(layer => ({ method: Object.keys(layer.route.methods)[0], path: layer.route.path.replace(/:\w+/g, "x") }));
  assert.ok(routes.length >= 15, "the admin surface was found");
  for (const { method, path } of routes) {
    const anonymous = await api(method.toUpperCase(), path, { body: {} });
    assert.equal(anonymous.status, 401, `${method} ${path} must reject anonymous callers`);
    const ordinary = await api(method.toUpperCase(), path, { token: tokens.alice, body: {} });
    assert.equal(ordinary.status, 401, `${method} ${path} must reject non-admin users`);
    assert.equal(ordinary.body.success, false);
  }
});

test("an admin sees usage numbers across every studio", opts, async () => {
  const res = await api("GET", "/admin/ai-video/overview", { token: tokens.admin });
  assert.equal(res.status, 200);
  const o = res.body.data;
  assert.equal(o.studios, 2);
  assert.equal(o.users, 2);
  assert.equal(o.creditsOutstanding, 100);
  assert.equal(o.videos.total, 4);
  assert.equal(o.videos.completed, 2);
  assert.equal(o.videos.failed, 1);
  assert.equal(o.videos.rendering, 1);
  assert.equal(o.videos.secondsRendered, 42);
  assert.equal(o.videos.perDay.length, 7);
  assert.equal(o.videos.perDay.reduce((sum, d) => sum + d.created, 0), 4);
  assert.ok(o.videos.averageRenderSeconds > 0);
  assert.equal(o.voiceovers, 1);
  assert.deepEqual(o.avatars.map(a => `${a.kind}:${a.status}`).sort(), ["clone:Consent needed", "photo:Ready"]);
  assert.equal(o.orders.revenueAllTime, 299);
  assert.equal(o.orders.paidLast30Days, 1);
  assert.deepEqual(o.enterprise, [{ status: "requested", count: 1 }]);
  assert.equal(o.recentFailures[0].title, "Broken render");
});

test("videos can be filtered, searched by owner, and paged", opts, async () => {
  let res = await api("GET", "/admin/ai-video/videos?limit=2&page=1", { token: tokens.admin });
  assert.equal(res.body.total, 4);
  assert.equal(res.body.totalPages, 2);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.data[0].title, "Still going", "newest first");

  res = await api("GET", "/admin/ai-video/videos?status=Failed", { token: tokens.admin });
  assert.deepEqual(res.body.data.map(v => v.title), ["Broken render"]);
  assert.equal(res.body.data[0].status, "Failed");

  res = await api("GET", "/admin/ai-video/videos?search=9876500002", { token: tokens.admin });
  assert.deepEqual(res.body.data.map(v => v.title), ["Bob promo"]);
  assert.equal(res.body.data[0].user.name, "Bob Verma");

  res = await api("GET", "/admin/ai-video/videos?search=alice%40example", { token: tokens.admin });
  assert.equal(res.body.total, 3);

  res = await api("GET", "/admin/ai-video/videos?search=diwali", { token: tokens.admin });
  const [video] = res.body.data;
  assert.equal(video.projectId, "a1");
  assert.equal(video.studioId, ids.studioA);
  assert.equal(video.script.length, 600, "long scripts are trimmed in lists");
  assert.equal(video.renderSeconds, 120);
  assert.equal(video.businessId, "biz-alice");

  // Regex characters in a search are text, not patterns.
  res = await api("GET", "/admin/ai-video/videos?search=.*", { token: tokens.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 0);
});

test("avatar and studio lists show owners, hide stock presenters, and count what each studio holds", opts, async () => {
  let res = await api("GET", "/admin/ai-video/avatars", { token: tokens.admin });
  assert.deepEqual(res.body.data.map(a => a.name).sort(), ["Alice Photo", "Alice Twin"]);
  res = await api("GET", "/admin/ai-video/avatars?kind=clone&status=Consent%20needed", { token: tokens.admin });
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].consent, "pending");

  res = await api("GET", "/admin/ai-video/studios?search=bob", { token: tokens.admin });
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].credits, 20);
  assert.deepEqual(res.body.data[0].counts, { videos: 1, avatars: 0, voiceovers: 0, orders: 0 });
  res = await api("GET", "/admin/ai-video/studios?search=alice", { token: tokens.admin });
  assert.equal(res.body.data[0].counts.avatars, 2, "only the customer's own avatars are counted");

  res = await api("GET", `/admin/ai-video/studios/${ids.studioA}`, { token: tokens.admin });
  assert.equal(res.body.data.user.mobile, 9876500001);
  assert.equal(res.body.data.videos.length, 3);
  assert.equal(res.body.data.orders.length, 2);
  assert.equal(res.body.data.avatars.length, 2);
  assert.equal(res.body.data.voiceovers, 1);
  assert.equal((await api("GET", "/admin/ai-video/studios/not-an-id", { token: tokens.admin })).status, 400);
});

test("orders list shows who paid what", opts, async () => {
  let res = await api("GET", "/admin/ai-video/orders?status=paid", { token: tokens.admin });
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].razorpayPaymentId, "pay_A");
  assert.equal(res.body.data[0].user.name, "Alice Sharma");
  res = await api("GET", "/admin/ai-video/orders?search=order_B", { token: tokens.admin });
  assert.deepEqual(res.body.data.map(o => o.status), ["pending_payment"]);
});

test("credit changes need a reason, can never go below zero, and leave an audit trail", opts, async () => {
  const path = `/admin/ai-video/studios/${ids.studioB}/credits`;
  assert.equal((await api("POST", path, { token: tokens.admin, body: { amount: 10 } })).status, 400, "reason is required");
  for (const amount of [0, 1.5, "lots", 100001]) {
    assert.equal((await api("POST", path, { token: tokens.admin, body: { amount, reason: "test" } })).status, 400, String(amount));
  }
  let res = await api("POST", path, { token: tokens.admin, body: { amount: 30, reason: "Goodwill for a failed demo" } });
  assert.equal(res.body.data.credits, 50);
  res = await api("POST", path, { token: tokens.admin, body: { amount: -45, reason: "Reverse a test grant" } });
  assert.equal(res.body.data.credits, 5);
  res = await api("POST", path, { token: tokens.admin, body: { amount: -6, reason: "Too much" } });
  assert.equal(res.status, 400);
  assert.equal((await Studio.findById(ids.studioB)).credits, 5);
  assert.equal((await api("POST", "/admin/ai-video/studios/64b0000000000000000000ff/credits", { token: tokens.admin, body: { amount: 5, reason: "nobody" } })).status, 404);

  const audit = await api("GET", `/admin/ai-video/audit?action=credits.adjust&studioId=${ids.studioB}`, { token: tokens.admin });
  assert.equal(audit.body.total, 2);
  const [latest] = audit.body.data;
  assert.equal(latest.adminName, "Admin One");
  assert.deepEqual({ before: latest.data.before, after: latest.data.after, amount: latest.data.amount }, { before: 50, after: 5, amount: -45 });
  assert.match(latest.summary, /Removed 45 credits/);
});

test("concurrent credit removals cannot overdraw a balance", opts, async () => {
  await Studio.updateOne({ _id: ids.studioB }, { $set: { credits: 10 } });
  const results = await Promise.allSettled([1, 2, 3, 4].map(n => admin.adjustCredits({ admin: adminActor(), studioId: ids.studioB, amount: -10, reason: `race ${n}` })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await Studio.findById(ids.studioB)).credits, 0);
  await Studio.updateOne({ _id: ids.studioB }, { $set: { credits: 20 } });
});

test("an admin can grant a plan for a number of days, or return a studio to free", opts, async () => {
  const path = `/admin/ai-video/studios/${ids.studioB}/plan`;
  assert.equal((await api("POST", path, { token: tokens.admin, body: { planId: "gold", days: 30 } })).status, 400);
  assert.equal((await api("POST", path, { token: tokens.admin, body: { planId: "pro", days: 0 } })).status, 400);
  let res = await api("POST", path, { token: tokens.admin, body: { planId: "pro", days: 30 } });
  assert.equal(res.body.data.plan, "pro");
  const renews = new Date(res.body.data.planRenewsAt).getTime();
  assert.ok(Math.abs(renews - (Date.now() + 30 * 24 * 3600 * 1000)) < 60000);
  res = await api("POST", path, { token: tokens.admin, body: { planId: "free" } });
  assert.equal(res.body.data.plan, "free");
  assert.equal(res.body.data.planRenewsAt, null);
  assert.equal((await api("GET", `/admin/ai-video/audit?action=plan.set&studioId=${ids.studioB}`, { token: tokens.admin })).body.total, 2);
});

test("a finished video can be refunded once, a running one cannot", opts, async () => {
  const path = pid => `/admin/ai-video/videos/${ids.studioA}/${pid}/refund`;
  assert.equal((await api("POST", path("a1"), { token: tokens.admin, body: {} })).status, 400, "reason required");
  assert.equal((await api("POST", path("a3"), { token: tokens.admin, body: { reason: "stuck" } })).status, 400, "still rendering");
  assert.equal((await api("POST", path("a2"), { token: tokens.admin, body: { reason: "again" } })).status, 400, "failed renders were already refunded");
  const before = (await Studio.findById(ids.studioA)).credits;
  let res = await api("POST", path("a1"), { token: tokens.admin, body: { reason: "Lip sync was off" } });
  assert.equal(res.body.data.refunded, 20);
  assert.equal(res.body.data.credits, before + 20);
  res = await api("POST", path("a1"), { token: tokens.admin, body: { reason: "twice" } });
  assert.equal(res.status, 400);
  assert.equal((await Studio.findById(ids.studioA)).credits, before + 20);
  assert.equal((await api("POST", path("nope"), { token: tokens.admin, body: { reason: "ghost" } })).status, 404);
});

test("deleting a video removes it, cleans the provider copy, and refuses one that is rendering", opts, async () => {
  assert.equal((await api("DELETE", `/admin/ai-video/videos/${ids.studioA}/a3`, { token: tokens.admin })).status, 400);
  const before = h.mock.calls.length;
  const res = await api("DELETE", `/admin/ai-video/videos/${ids.studioB}/b1`, { token: tokens.admin });
  assert.equal(res.status, 200);
  assert.equal((await Studio.findById(ids.studioB)).projects.length, 0);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(h.mock.calls.slice(before).length, 0, "b1 had no provider video, so nothing is sent");
  assert.equal((await api("GET", `/admin/ai-video/audit?action=video.delete`, { token: tokens.admin })).body.total, 1);

  const second = await api("DELETE", `/admin/ai-video/videos/${ids.studioA}/a1`, { token: tokens.admin });
  assert.equal(second.status, 200);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(h.mock.callsTo("DELETE", "/v3/videos/vid_a1").length, 1);
});

test("removing a customer's avatar deletes it on the provider and is audited", opts, async () => {
  const res = await api("DELETE", `/admin/ai-video/avatars/${ids.studioA}/av-twin`, { token: tokens.admin });
  assert.equal(res.status, 200);
  assert.equal(h.mock.callsTo("DELETE", "/v3/avatars/grp_twin").length, 1);
  assert.equal((await Studio.findById(ids.studioA)).avatars.some(a => a.id === "av-twin"), false);
  assert.equal((await api("DELETE", `/admin/ai-video/avatars/${ids.studioA}/priya`, { token: tokens.admin })).status, 404, "stock presenters stay");
  assert.equal((await api("GET", `/admin/ai-video/audit?action=avatar.delete`, { token: tokens.admin })).body.total, 1);
});

test("enterprise requests can be listed and moved along, with a note", opts, async () => {
  let res = await api("GET", "/admin/ai-video/enterprise?status=requested", { token: tokens.admin });
  assert.equal(res.body.total, 1);
  assert.equal(res.body.data[0].company, "Alice Fashions");
  assert.equal((await api("PATCH", `/admin/ai-video/enterprise/${ids.studioA}`, { token: tokens.admin, body: { status: "maybe" } })).status, 400);
  res = await api("PATCH", `/admin/ai-video/enterprise/${ids.studioA}`, { token: tokens.admin, body: { status: "contacted", note: "Called on Monday" } });
  assert.equal(res.body.data.status, "contacted");
  res = await api("GET", "/admin/ai-video/enterprise?status=contacted", { token: tokens.admin });
  assert.equal(res.body.data[0].note, "Called on Monday");
  assert.equal((await api("PATCH", `/admin/ai-video/enterprise/${ids.studioB}`, { token: tokens.admin, body: { status: "approved" } })).status, 404, "Bob never asked");
});

test("settings start at the shipped defaults, validate every field, and stay changed", opts, async () => {
  let res = await api("GET", "/admin/ai-video/settings", { token: tokens.admin });
  const s = res.body.data;
  assert.equal(s.enabled, true);
  assert.equal(s.videoCost, logic.VIDEO_COST);
  assert.equal(s.voiceoverCost, logic.VOICEOVER_COST);
  assert.deepEqual(s.packs.map(p => p.id), logic.PACKS.map(p => p.id));
  assert.deepEqual(s.plans.map(p => p.id), logic.PLANS.map(p => p.id));
  assert.equal(s.resolution, "1080p");

  const put = body => api("PUT", "/admin/ai-video/settings", { token: tokens.admin, body });
  for (const bad of [
    {}, { videoCost: 0 }, { videoCost: 1.5 }, { videoCost: "x" }, { freeCredits: -1 }, { maxConcurrentRenders: 50 }, { resolution: "8k" },
    { packs: [] }, { packs: [{ id: "Bad Id", credits: 10, price: 10 }] }, { packs: [{ id: "a1", credits: 10, price: 10 }, { id: "a1", credits: 20, price: 20 }] },
    { packs: [{ id: "a1", credits: 0, price: 10 }] }, { plans: [{ id: "pro", name: "Pro", price: 10, yearlyPrice: 100, monthlyCredits: 5 }] },
    { plans: [{ id: "free", name: "Free", monthlyCredits: 10 }, { id: "pro", name: "Pro", price: 0, yearlyPrice: 10, monthlyCredits: 5 }] },
  ]) {
    assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(JSON.stringify((await api("GET", "/admin/ai-video/settings", { token: tokens.admin })).body.data), JSON.stringify(s), "failed saves change nothing");

  res = await put({ videoCost: 35, enabled: false, packs: [{ id: "pack_50", credits: 50, price: 149 }], unknownField: "ignored" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.videoCost, 35);
  assert.equal(res.body.data.enabled, false);
  assert.deepEqual(res.body.data.packs, [{ id: "pack_50", credits: 50, price: 149, active: true }]);
  assert.equal(res.body.data.voiceoverCost, logic.VOICEOVER_COST, "untouched fields keep their value");
  assert.equal(res.body.data.unknownField, undefined);

  settings.invalidate();
  assert.equal((await settings.get()).videoCost, 35, "survives a cache reset because it is stored");

  const audit = await api("GET", "/admin/ai-video/audit?action=settings.update", { token: tokens.admin });
  assert.equal(audit.body.total, 1);
  assert.deepEqual(audit.body.data[0].data.videoCost, { from: logic.VIDEO_COST, to: 35 });
  assert.equal(audit.body.data[0].adminName, "Admin One");

  await put({ ...settings.defaults(), packs: settings.defaults().packs, plans: settings.defaults().plans });
});

test("the presenter chosen in settings is the one used, and a bad choice falls back safely", opts, async () => {
  catalog.clearCache();
  const put = body => api("PUT", "/admin/ai-video/settings", { token: tokens.admin, body });
  await put({ presenters: { priya: "preset-raj", raj: "" } });
  settings.invalidate();
  assert.equal((await catalog.resolvePresenter("priya")).avatarId, "preset-raj");
  await put({ presenters: { priya: "no-such-look", raj: "" } });
  settings.invalidate();
  catalog.clearCache();
  assert.equal((await catalog.resolvePresenter("priya")).avatarId, "preset-priya", "falls back to the deployment's preset");
  await put({ presenters: { priya: "", raj: "" } });
  settings.invalidate();
  catalog.clearCache();
});

test("health reports the provider, presenters and what is configured, without any secrets", opts, async () => {
  h.mock.balance = 0;
  const res = await api("GET", "/admin/ai-video/health", { token: tokens.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.provider.canRender, false);
  assert.equal(res.body.data.presenters.priya.ok, true);
  assert.equal(typeof res.body.data.config.scriptWriter, "boolean");
  assert.ok(!JSON.stringify(res.body).includes("test-key"));
});
