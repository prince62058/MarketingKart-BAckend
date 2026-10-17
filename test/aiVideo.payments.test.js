// Runs the real AI video payment code against a throwaway local mongod and a stand-in for the
// Razorpay API. Never touches the database in .env and never reaches Razorpay.
// Skipped when `mongod` is not installed.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const hasMongod = spawnSync("mongod", ["--version"]).status === 0;

const KEY_ID = "rzp_test_unit";
const KEY_SECRET = "unit_test_secret";
const WEBHOOK_SECRET = "unit_webhook_secret";

let mongod;
let dbDir;
let mongoose;
let mock;
let service;
let logic;
let Studio;
let User;
let Transaction;

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

const sign = (orderId, paymentId, secret = KEY_SECRET) => crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

// A stand-in for the parts of Razorpay's API the service uses, shaped from its public docs.
async function startMockRazorpay() {
  const port = await freePort();
  const state = {
    base: `http://127.0.0.1:${port}`,
    calls: [],
    orders: new Map(),
    payments: new Map(),
    seq: 0,
    createStatus: 200,
    lookupStatus: 200,
  };
  state.callsTo = (method, route) => state.calls.filter(call => call.method === method && call.path === route);

  // What the customer's checkout does: pay an order, then hand the app its three ids.
  state.checkout = (orderId, overrides = {}) => {
    const order = state.orders.get(orderId);
    const id = `pay_${++state.seq}`;
    const payment = {
      id,
      entity: "payment",
      order_id: orderId,
      amount: order.amount,
      currency: "INR",
      status: "captured",
      captured: true,
      amount_refunded: 0,
      method: "card",
      card: { last4: "1111", network: "Visa" },
      ...overrides,
    };
    state.payments.set(id, payment);
    if (payment.status === "captured") Object.assign(order, { status: "paid", amount_paid: payment.amount });
    return { orderId, paymentId: id, signature: sign(orderId, id) };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, state.base);
    const raw = await readBody(req);
    const body = raw.length ? JSON.parse(raw.toString()) : null;
    state.calls.push({ method: req.method, path: url.pathname, body });
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const expected = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;
    if (req.headers.authorization !== expected) {
      return send(401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });
    }

    let match;
    if (req.method === "POST" && url.pathname === "/v1/orders") {
      if (state.createStatus !== 200) return send(state.createStatus, { error: { code: "SERVER_ERROR", description: "boom" } });
      const id = `order_${++state.seq}`;
      const order = { id, entity: "order", amount: body.amount, amount_paid: 0, currency: body.currency, receipt: body.receipt, notes: body.notes, status: "created" };
      state.orders.set(id, order);
      return send(200, order);
    }
    if ((match = url.pathname.match(/^\/v1\/payments\/([^/]+)$/)) && req.method === "GET") {
      if (state.lookupStatus !== 200) return send(state.lookupStatus, { error: { code: "SERVER_ERROR", description: "boom" } });
      const payment = state.payments.get(match[1]);
      if (!payment) return send(400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } });
      return send(200, payment);
    }
    if ((match = url.pathname.match(/^\/v1\/payments\/([^/]+)\/capture$/)) && req.method === "POST") {
      const payment = state.payments.get(match[1]);
      if (!payment || payment.status !== "authorized") {
        return send(400, { error: { code: "BAD_REQUEST_ERROR", description: "This payment has already been captured" } });
      }
      if (body.amount !== payment.amount) return send(400, { error: { code: "BAD_REQUEST_ERROR", description: "Capture amount must be equal to the amount authorized" } });
      Object.assign(payment, { status: "captured", captured: true });
      Object.assign(state.orders.get(payment.order_id), { status: "paid", amount_paid: payment.amount });
      return send(200, payment);
    }
    return send(404, { error: { code: "BAD_REQUEST_ERROR", description: `unmocked ${req.method} ${url.pathname}` } });
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
  return `mongodb://127.0.0.1:${port}/aivideo_payments_test`;
}

const studioOf = uid => Studio.findOne({ userId: uid });
const orderOf = async (uid, orderId) => (await studioOf(uid)).orders.find(item => item.id === orderId);
const walletOf = async uid => (await User.findById(uid)).wallet;
const newUser = async wallet => (await User.create({ name: "Buyer", wallet }))._id;
const buyer = () => new mongoose.Types.ObjectId();

// The app creates an order, pays it in Razorpay's sheet, and gets three ids back.
async function buyAndPay(uid, input, overrides) {
  const created = await service.createOrder(uid, null, input);
  const paid = mock.checkout(created.payment.orderId, overrides);
  return { created, paid };
}

function webhookRequest(event, { secret = WEBHOOK_SECRET } = {}) {
  const rawBody = Buffer.from(JSON.stringify(event));
  return { rawBody, signature: crypto.createHmac("sha256", secret).update(rawBody).digest("hex") };
}

const capturedEvent = (paid, name = "payment.captured") => ({
  event: name,
  payload: { payment: { entity: { id: paid.paymentId, order_id: paid.orderId, status: "captured" } } },
});

before(async () => {
  if (!hasMongod) return;
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "aivideo-pay-mongo-"));
  mock = await startMockRazorpay();
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_API_BASE_URL: mock.base,
    HEYGEN_API_KEY: "not-used-here",
    AI_VIDEO_POLL_INTERVAL_MS: "0",
  });

  const quiet = { info() {}, warn() {}, error() {}, debug() {} };
  const fake = (rel, exports) => {
    const file = require.resolve(rel);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  fake("../src/utils/logger", quiet);
  fake("../src/utils/spacesClient", { uploadBuffer: async () => ({}) });

  mongoose = require("mongoose");
  await mongoose.connect(await startMongod(), { serverSelectionTimeoutMS: 15000 });
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  User = require("../src/models/userModel");
  Transaction = require("../src/models/transtionModel");
  await Promise.all([Studio.init(), User.init()]);
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

// ---------------------------------------------------------------------------
// Creating an order
// ---------------------------------------------------------------------------

test("an order is priced by the server, creates a Razorpay order, and grants nothing yet", opts, async () => {
  const uid = buyer();
  const before = mock.callsTo("POST", "/v1/orders").length;
  const created = await service.createOrder(uid, null, { kind: "pack", packId: "pack_500" });

  assert.equal(created.granted, false);
  assert.equal(created.credits, 120);
  assert.equal(created.order.status, "pending_payment");
  assert.equal(created.order.price, 999);
  assert.equal(created.order.credits, 500);
  assert.deepEqual(
    { gateway: created.payment.gateway, keyId: created.payment.keyId, amount: created.payment.amount, currency: created.payment.currency },
    { gateway: "razorpay", keyId: KEY_ID, amount: 99900, currency: "INR" },
  );

  const call = mock.callsTo("POST", "/v1/orders")[before];
  assert.equal(call.body.amount, 99900);
  assert.equal(call.body.currency, "INR");
  assert.equal(call.body.receipt, created.order.id);
  assert.equal((await studioOf(uid)).credits, 120);
  assert.ok(!JSON.stringify(created).includes(KEY_SECRET));
});

test("an amount, price or credit count sent by the client is ignored", opts, async () => {
  const uid = buyer();
  const created = await service.createOrder(uid, null, { kind: "pack", packId: "pack_100", amount: 1, price: 1, credits: 99999, amountPaise: 100 });
  assert.equal(created.payment.amount, 29900);
  assert.equal(created.order.credits, 100);
  assert.equal(mock.orders.get(created.payment.orderId).amount, 29900);
});

test("only items that are on sale can be ordered", opts, async () => {
  const uid = buyer();
  for (const input of [
    { kind: "pack", packId: "pack_999999" },
    { kind: "pack" },
    { kind: "plan", planId: "free" },
    { kind: "plan", planId: "enterprise" },
    {},
  ]) {
    await assert.rejects(service.createOrder(uid, null, input), error => error.status === 400 && /valid credit pack or plan/.test(error.message));
  }
  // A rejected request does not even create a studio.
  assert.equal(await studioOf(uid), null);
});

test("tapping the same pack again reuses the open order instead of piling up orders", opts, async () => {
  const uid = buyer();
  const first = await service.createOrder(uid, null, { kind: "pack", packId: "pack_100" });
  const before = mock.callsTo("POST", "/v1/orders").length;
  const again = await service.createOrder(uid, null, { kind: "pack", packId: "pack_100" });
  assert.equal(again.payment.orderId, first.payment.orderId);
  assert.equal(again.order.id, first.order.id);
  assert.equal(mock.callsTo("POST", "/v1/orders").length, before);
  assert.equal((await studioOf(uid)).orders.length, 1);

  const other = await service.createOrder(uid, null, { kind: "pack", packId: "pack_500" });
  assert.notEqual(other.payment.orderId, first.payment.orderId);
});

test("abandoned orders are cleaned up and the number of open orders is capped", opts, async () => {
  const uid = buyer();
  const old = await service.createOrder(uid, null, { kind: "pack", packId: "pack_100" });
  await Studio.updateOne({ userId: uid, "orders.id": old.order.id }, { $set: { "orders.$.createdAt": new Date(Date.now() - 25 * 60 * 60 * 1000) } });
  const fresh = await service.createOrder(uid, null, { kind: "pack", packId: "pack_100" });
  assert.notEqual(fresh.order.id, old.order.id);
  assert.deepEqual((await studioOf(uid)).orders.map(item => item.id), [fresh.order.id]);

  const capped = buyer();
  await service.getStudio(capped, null);
  const filler = Array.from({ length: logic.MAX_PENDING_ORDERS }, (_, i) => ({ id: `fill${i}`, kind: "pack", itemId: "pack_500", price: 999, credits: 500, status: "pending_payment", method: "razorpay", createdAt: new Date() }));
  await Studio.updateOne({ userId: capped }, { $set: { orders: filler } });
  await assert.rejects(service.createOrder(capped, null, { kind: "pack", packId: "pack_100" }), error => error.status === 400 && /too many unpaid orders/.test(error.message));
});

test("no order is saved when Razorpay is not configured or is down", opts, async () => {
  const uid = buyer();
  const id = process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_ID;
  try {
    await assert.rejects(service.createOrder(uid, null, { kind: "pack", packId: "pack_100" }), error => error.status === 503 && /unavailable/.test(error.message));
  } finally {
    process.env.RAZORPAY_KEY_ID = id;
  }
  mock.createStatus = 500;
  try {
    await assert.rejects(service.createOrder(uid, null, { kind: "pack", packId: "pack_100" }), error => error.status === 503);
  } finally {
    mock.createStatus = 200;
  }
  assert.equal((await studioOf(uid)).orders.length, 0);
});

// ---------------------------------------------------------------------------
// Confirming a payment
// ---------------------------------------------------------------------------

test("a verified payment grants the pack's credits once and reports the real payment", opts, async () => {
  const uid = buyer();
  const { created, paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_500" });
  const result = await service.confirmPayment(uid, paid);

  assert.equal(result.granted, true);
  assert.equal(result.credits, 620);
  assert.equal(result.order.status, "paid");
  assert.equal(result.order.transactionId, paid.paymentId);
  assert.equal(result.order.methodLabel, "Visa •••• 1111");
  assert.ok(result.order.paidAt);
  assert.equal(result.order.id, created.order.id);
  assert.equal((await studioOf(uid)).credits, 620);
  assert.equal((await studioOf(uid)).plan, "free");
});

test("confirming the same payment again, or three times at once, grants only once", opts, async () => {
  const uid = buyer();
  const { paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" });
  const results = await Promise.allSettled([service.confirmPayment(uid, paid), service.confirmPayment(uid, paid), service.confirmPayment(uid, paid)]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 3);
  assert.equal((await studioOf(uid)).credits, 220);

  const replay = await service.confirmPayment(uid, paid);
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(replay.credits, 220);
  assert.equal((await studioOf(uid)).credits, 220);
});

test("a wrong, missing or foreign signature is refused and grants nothing", opts, async () => {
  const uid = buyer();
  const { paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" });
  const refused = [
    { ...paid, signature: "0".repeat(64) },
    { ...paid, signature: sign(paid.orderId, paid.paymentId, "someone-elses-secret") },
    { ...paid, signature: "" },
    { ...paid, paymentId: "" },
    { orderId: paid.orderId, paymentId: paid.paymentId },
    {},
  ];
  for (const input of refused) {
    await assert.rejects(service.confirmPayment(uid, input), error => error.status === 400);
  }
  assert.equal((await studioOf(uid)).credits, 120);
  assert.equal((await orderOf(uid, (await studioOf(uid)).orders[0].id)).status, "pending_payment");
});

test("nobody can confirm another customer's order", opts, async () => {
  const owner = buyer();
  const stranger = buyer();
  const { paid } = await buyAndPay(owner, { kind: "pack", packId: "pack_100" });
  await assert.rejects(service.confirmPayment(stranger, paid), error => error.status === 404);
  assert.equal((await studioOf(owner)).credits, 120);
});

test("a payment for a different order, or for a different amount, grants nothing", opts, async () => {
  const uid = buyer();
  const a = await service.createOrder(uid, null, { kind: "pack", packId: "pack_100" });
  const b = await service.createOrder(uid, null, { kind: "pack", packId: "pack_1200" });

  // A genuine payment for the cheap order, presented against the expensive one.
  const cheap = mock.checkout(a.payment.orderId);
  await assert.rejects(
    service.confirmPayment(uid, { orderId: b.payment.orderId, paymentId: cheap.paymentId, signature: sign(b.payment.orderId, cheap.paymentId) }),
    error => error.status === 400 && /does not belong/.test(error.message),
  );

  // A payment whose amount is not what our own record says the order costs.
  const short = mock.checkout(b.payment.orderId, { amount: 100 });
  await assert.rejects(service.confirmPayment(uid, short), error => error.status === 400 && /does not match/.test(error.message));

  assert.equal((await studioOf(uid)).credits, 120);
});

test("a payment that is failed, refunded or still unpaid grants nothing", opts, async () => {
  const uid = buyer();
  for (const overrides of [{ status: "failed", captured: false }, { status: "created", captured: false }, { status: "refunded" }, { amount_refunded: 29900 }]) {
    const { paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" }, overrides);
    await assert.rejects(service.confirmPayment(uid, paid), error => error.status === 402);
    await Studio.updateOne({ userId: uid }, { $set: { orders: [] } });
  }
  assert.equal((await studioOf(uid)).credits, 120);
});

test("an authorized payment is captured for exactly the order amount, then granted", opts, async () => {
  const uid = buyer();
  const { paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" }, { status: "authorized", captured: false });
  const result = await service.confirmPayment(uid, paid);
  assert.equal(result.credits, 220);
  const capture = mock.callsTo("POST", `/v1/payments/${paid.paymentId}/capture`).pop();
  assert.deepEqual(capture.body, { amount: 29900, currency: "INR" });
});

test("a Razorpay outage while verifying is retryable and grants nothing; an unknown payment is refused", opts, async () => {
  const uid = buyer();
  const { paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" });
  mock.lookupStatus = 500;
  try {
    await assert.rejects(service.confirmPayment(uid, paid), error => error.status === 503);
  } finally {
    mock.lookupStatus = 200;
  }
  assert.equal((await studioOf(uid)).credits, 120);

  // Still payable once Razorpay is back.
  assert.equal((await service.confirmPayment(uid, paid)).credits, 220);

  const ghost = await service.createOrder(uid, null, { kind: "pack", packId: "pack_500" });
  const unknown = { orderId: ghost.payment.orderId, paymentId: "pay_does_not_exist", signature: sign(ghost.payment.orderId, "pay_does_not_exist") };
  await assert.rejects(service.confirmPayment(uid, unknown), error => error.status === 400);
});

test("one order cannot be paid for twice with two different payments", opts, async () => {
  const uid = buyer();
  const { created, paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" });
  await service.confirmPayment(uid, paid);
  const second = mock.checkout(created.payment.orderId);
  await assert.rejects(service.confirmPayment(uid, second), error => error.status === 409);
  assert.equal((await studioOf(uid)).credits, 220);
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

test("the catalog matches what the Upgrade screen sells", opts, async () => {
  const pro = (id, billing) => logic.resolvePurchase({ kind: "plan", planId: id, billing });
  assert.deepEqual([pro("pro", "monthly").price, pro("pro", "yearly").price], [499, 2994]);
  assert.deepEqual([pro("business", "monthly").price, pro("business", "yearly").price], [1499, 8994]);
  // 50 and 200 videos a month at 20 credits each.
  assert.deepEqual([pro("pro", "monthly").credits, pro("business", "monthly").credits], [1000, 4000]);
  assert.equal(pro("pro", "yearly").credits, 12000);
  assert.equal(pro("free", "monthly"), null);
  const studio = service.present(await service.getStudio(buyer(), null));
  assert.deepEqual(studio.plans.map(item => item.id), ["free", "pro", "business"]);
});

test("a monthly plan grants a month of credits and a 30 day plan", opts, async () => {
  const uid = buyer();
  const { created, paid } = await buyAndPay(uid, { kind: "plan", planId: "pro", billing: "monthly" });
  assert.equal(created.payment.amount, 49900);
  assert.equal(created.order.billing, "monthly");

  const result = await service.confirmPayment(uid, paid);
  assert.equal(result.credits, 1120);
  assert.equal(result.plan, "pro");
  const days = (new Date(result.planRenewsAt) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30);
  assert.equal(service.present(await service.getStudio(uid, null)).plan, "pro");
});

test("a yearly business plan is charged at the yearly price and runs for a year", opts, async () => {
  const uid = buyer();
  const { created, paid } = await buyAndPay(uid, { kind: "plan", planId: "business", billing: "yearly" });
  assert.equal(created.payment.amount, 899400);
  const result = await service.confirmPayment(uid, paid);
  assert.equal(result.credits, 120 + 48000);
  assert.equal(result.plan, "business");
  const days = (new Date(result.planRenewsAt) - Date.now()) / 86400000;
  assert.ok(days > 364.9 && days <= 365);
});

test("renewing the same plan adds to the time left, and a lapsed plan reads as free", opts, async () => {
  const uid = buyer();
  const first = await buyAndPay(uid, { kind: "plan", planId: "pro", billing: "monthly" });
  await service.confirmPayment(uid, first.paid);
  const second = await buyAndPay(uid, { kind: "plan", planId: "pro", billing: "monthly" });
  const renewed = await service.confirmPayment(uid, second.paid);
  const days = (new Date(renewed.planRenewsAt) - Date.now()) / 86400000;
  assert.ok(days > 59.9 && days <= 60);
  assert.equal(renewed.credits, 120 + 2000);

  await Studio.updateOne({ userId: uid }, { $set: { planRenewsAt: new Date(Date.now() - 1000) } });
  const lapsed = service.present(await service.getStudio(uid, null));
  assert.equal(lapsed.plan, "free");
  assert.equal(lapsed.credits, 2120);
});

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

test("the webhook grants a payment the app never confirmed, once, however often Razorpay retries", opts, async () => {
  const uid = buyer();
  const { paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" });
  const request = webhookRequest(capturedEvent(paid));
  assert.deepEqual(await service.handleRazorpayWebhook(request), { handled: true });
  assert.deepEqual(await service.handleRazorpayWebhook(request), { handled: true });
  assert.equal((await studioOf(uid)).credits, 220);

  // The app arriving late is told the truth and grants nothing more.
  const late = await service.confirmPayment(uid, paid);
  assert.equal(late.alreadyProcessed, true);
  assert.equal((await studioOf(uid)).credits, 220);
});

test("the webhook and the app confirming at the same moment grant once", opts, async () => {
  const uid = buyer();
  const { paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_500" });
  const request = webhookRequest(capturedEvent(paid, "order.paid"));
  await Promise.allSettled([service.confirmPayment(uid, paid), service.handleRazorpayWebhook(request), service.confirmPayment(uid, paid), service.handleRazorpayWebhook(request)]);
  assert.equal((await studioOf(uid)).credits, 620);
  assert.equal((await orderOf(uid, (await studioOf(uid)).orders[0].id)).status, "paid");
});

test("the webhook refuses a bad signature and cannot be tricked by a forged payload", opts, async () => {
  const uid = buyer();
  const { created } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" });
  // Claims a payment that Razorpay has never seen, with a signature made with the wrong secret.
  const forged = { orderId: created.payment.orderId, paymentId: "pay_forged" };
  await assert.rejects(service.handleRazorpayWebhook(webhookRequest(capturedEvent(forged), { secret: "wrong" })), error => error.status === 400);
  await assert.rejects(service.handleRazorpayWebhook({ rawBody: Buffer.from("{}"), signature: undefined }), error => error.status === 400);

  // Even a correctly signed event is checked against Razorpay itself before anything is granted.
  assert.deepEqual(await service.handleRazorpayWebhook(webhookRequest(capturedEvent(forged))), { handled: false });
  assert.equal((await studioOf(uid)).credits, 120);
});

test("the webhook ignores other events and other products' orders, and needs its secret", opts, async () => {
  const stranger = mock.checkout(mock.orders.keys().next().value);
  assert.deepEqual(await service.handleRazorpayWebhook(webhookRequest(capturedEvent({ orderId: "order_from_the_wallet_flow", paymentId: stranger.paymentId }))), { handled: false });
  assert.deepEqual(await service.handleRazorpayWebhook(webhookRequest({ event: "payment.failed", payload: {} })), { handled: false });

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  try {
    await assert.rejects(service.handleRazorpayWebhook(webhookRequest(capturedEvent(stranger))), error => error.status === 503);
  } finally {
    process.env.RAZORPAY_WEBHOOK_SECRET = secret;
  }
});

test("a Razorpay outage during a webhook asks Razorpay to retry instead of dropping it", opts, async () => {
  const uid = buyer();
  const { paid } = await buyAndPay(uid, { kind: "pack", packId: "pack_100" });
  mock.lookupStatus = 500;
  try {
    await assert.rejects(service.handleRazorpayWebhook(webhookRequest(capturedEvent(paid))), error => error.status >= 500);
  } finally {
    mock.lookupStatus = 200;
  }
  assert.equal((await studioOf(uid)).credits, 120);
  assert.deepEqual(await service.handleRazorpayWebhook(webhookRequest(capturedEvent(paid))), { handled: true });
  assert.equal((await studioOf(uid)).credits, 220);
});

// ---------------------------------------------------------------------------
// Paying from the MarketingKart wallet
// ---------------------------------------------------------------------------

test("a wallet payment debits the balance once, grants the plan, and leaves a ledger entry", opts, async () => {
  const uid = await newUser(1000);
  const created = await service.createOrder(uid, null, { kind: "plan", planId: "pro", billing: "monthly", method: "wallet" });
  assert.equal(created.payment.gateway, "wallet");
  assert.equal(created.payment.orderId, undefined);
  assert.equal(await walletOf(uid), 1000);
  assert.equal((await studioOf(uid)).credits, 120);

  const result = await service.payWithWallet(uid, created.order.id);
  assert.equal(result.granted, true);
  assert.equal(result.credits, 1120);
  assert.equal(result.plan, "pro");
  assert.equal(result.order.methodLabel, "Wallet");
  assert.equal(await walletOf(uid), 501);

  const ledger = await Transaction.find({ transactionId: `aivideo_${created.order.id}` });
  assert.equal(ledger.length, 1);
  assert.deepEqual([ledger[0].type, ledger[0].amount, ledger[0].previousBalance, ledger[0].newBalance], ["DEBIT", 499, 1000, 501]);

  // Paying the same order again changes nothing.
  const again = await service.payWithWallet(uid, created.order.id);
  assert.equal(again.alreadyProcessed, true);
  assert.equal(await walletOf(uid), 501);
  assert.equal((await studioOf(uid)).credits, 1120);
});

test("several wallet taps at once debit and grant exactly once", opts, async () => {
  const uid = await newUser(5000);
  const created = await service.createOrder(uid, null, { kind: "pack", packId: "pack_500", method: "wallet" });
  const results = await Promise.allSettled([1, 2, 3, 4].map(() => service.payWithWallet(uid, created.order.id)));
  assert.ok(results.some(item => item.status === "fulfilled" && item.value.granted));
  assert.equal(await walletOf(uid), 4001);
  assert.equal((await studioOf(uid)).credits, 620);
  assert.equal(await Transaction.countDocuments({ transactionId: `aivideo_${created.order.id}` }), 1);
});

test("a wallet that cannot cover the price is refused and nothing changes", opts, async () => {
  const uid = await newUser(100);
  const created = await service.createOrder(uid, null, { kind: "pack", packId: "pack_500", method: "wallet" });
  await assert.rejects(service.payWithWallet(uid, created.order.id), error => error.status === 400 && /wallet balance is not enough/.test(error.message));
  assert.equal(await walletOf(uid), 100);
  assert.equal((await studioOf(uid)).credits, 120);
  assert.equal((await orderOf(uid, created.order.id)).status, "pending_payment");

  // Topping up and trying again works on the same order.
  await User.updateOne({ _id: uid }, { $set: { wallet: 1500 } });
  assert.equal((await service.payWithWallet(uid, created.order.id)).credits, 620);
  assert.equal(await walletOf(uid), 501);
});

test("an interrupted wallet payment is finished by the next read without charging twice", opts, async () => {
  const stale = () => new Date(Date.now() - 5 * 60 * 1000);

  // Crashed after the debit but before the grant: the debit marker is there.
  const charged = await newUser(1000);
  const a = await service.createOrder(charged, null, { kind: "pack", packId: "pack_100", method: "wallet" });
  await Studio.updateOne({ userId: charged, "orders.id": a.order.id }, { $set: { "orders.$.status": "wallet_processing", "orders.$.claimedAt": stale() } });
  await User.updateOne({ _id: charged }, { $set: { wallet: 701 }, $push: { aiVideoWalletDebits: a.order.id } });
  const resumedA = service.present(await service.getStudio(charged, null));
  assert.equal(resumedA.credits, 220);
  assert.equal(await walletOf(charged), 701);
  assert.equal((await orderOf(charged, a.order.id)).status, "paid");

  // Crashed before the debit: nothing was taken yet, so it is taken now, once.
  const unbilled = await newUser(1000);
  const b = await service.createOrder(unbilled, null, { kind: "pack", packId: "pack_100", method: "wallet" });
  await Studio.updateOne({ userId: unbilled, "orders.id": b.order.id }, { $set: { "orders.$.status": "wallet_processing", "orders.$.claimedAt": stale() } });
  await service.getStudio(unbilled, null);
  await service.getStudio(unbilled, null);
  assert.equal(await walletOf(unbilled), 701);
  assert.equal((await studioOf(unbilled)).credits, 220);

  // A request still in flight is left alone.
  const busy = await newUser(1000);
  const c = await service.createOrder(busy, null, { kind: "pack", packId: "pack_100", method: "wallet" });
  await Studio.updateOne({ userId: busy, "orders.id": c.order.id }, { $set: { "orders.$.status": "wallet_processing", "orders.$.claimedAt": new Date() } });
  await service.getStudio(busy, null);
  assert.equal(await walletOf(busy), 1000);
  await assert.rejects(service.payWithWallet(busy, c.order.id), error => error.status === 409);
});

test("an online order cannot be paid from the wallet, and a wallet order cannot be confirmed online", opts, async () => {
  const uid = await newUser(5000);
  const online = await service.createOrder(uid, null, { kind: "pack", packId: "pack_100" });
  await assert.rejects(service.payWithWallet(uid, online.order.id), error => error.status === 400);
  await assert.rejects(service.payWithWallet(uid, "nope"), error => error.status === 404);
  await assert.rejects(service.payWithWallet(buyer(), online.order.id), error => error.status === 404);
  assert.equal(await walletOf(uid), 5000);

  const viaWallet = await service.createOrder(uid, null, { kind: "pack", packId: "pack_500", method: "wallet" });
  assert.equal(viaWallet.payment.orderId, undefined);
  assert.equal((await studioOf(uid)).orders.find(item => item.id === viaWallet.order.id).razorpayOrderId, undefined);
});
