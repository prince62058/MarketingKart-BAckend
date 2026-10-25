// Wallet top-ups through POST /api/transactions. The amount credited must be what Razorpay says was paid,
// not what the app says. Run against the real app, a throwaway replica-set mongod (the code uses
// transactions) and a local stand-in for Razorpay's API. It never reaches Razorpay.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { hasMongod, bootSecurityHarness, freePort } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
const KEY_ID = "rzp_test_unit";
const KEY_SECRET = "unit_test_secret";

let h;
let razorpay;
let User;
let Transaction;
let customer;
let token;
let adminToken;

const sign = (orderId, paymentId, secret = KEY_SECRET) => crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

async function startMockRazorpay() {
  const port = await freePort();
  const state = { base: `http://127.0.0.1:${port}`, orders: new Map(), calls: [], seq: 0 };

  // What the customer's checkout does: create an order for `rupees`, pay it, hand back the three ids.
  state.order = rupees => {
    const id = `order_${++state.seq}`;
    state.orders.set(id, { id, entity: "order", amount: rupees * 100, amount_paid: 0, currency: "INR", status: "created" });
    return id;
  };
  state.pay = (orderId, rupeesPaid) => {
    Object.assign(state.orders.get(orderId), { status: "paid", amount_paid: rupeesPaid * 100 });
    const paymentId = `pay_${++state.seq}`;
    return { orderId, paymentId, signature: sign(orderId, paymentId) };
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url, state.base);
      state.calls.push(`${req.method} ${url.pathname}`);
      const send = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.headers.authorization !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`) {
        return send(401, { error: { description: "Authentication failed" } });
      }
      let match;
      if (req.method === "POST" && url.pathname === "/v1/orders") {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const id = `order_${++state.seq}`;
        const order = { id, entity: "order", amount: body.amount, amount_paid: 0, currency: body.currency, status: "created" };
        state.orders.set(id, order);
        return send(200, order);
      }
      if (req.method === "GET" && (match = url.pathname.match(/^\/v1\/orders\/([^/]+)$/))) {
        const order = state.orders.get(match[1]);
        return order ? send(200, order) : send(400, { error: { description: "The id provided does not exist" } });
      }
      return send(404, { error: { description: `unmocked ${req.method} ${url.pathname}` } });
    });
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  state.close = () => {
    server.closeAllConnections?.();
    return new Promise(resolve => server.close(resolve));
  };
  return state;
}

before(async () => {
  if (skip) return;
  razorpay = await startMockRazorpay();
  h = await bootSecurityHarness({ replSet: true, env: { RAZORPAY_API_BASE_URL: razorpay.base } });
  User = require("../src/models/userModel");
  Transaction = require("../src/models/transtionModel");
  await Promise.all([User.createCollection(), Transaction.createCollection()]);
  await Transaction.init();
  customer = await fixtures.makeUser({ wallet: 0 });
  token = fixtures.tokenFor(customer);
  adminToken = fixtures.tokenFor(await fixtures.makeAdmin());
});

after(async () => {
  if (h) await h.close();
  if (razorpay) await razorpay.close();
});

const wallet = async () => (await User.findById(customer._id)).wallet;
const topUp = (paid, amount, extra = {}) => h.call("POST", "/api/transactions", { token, body: { type: "CREDIT", ...paid, amount, ...extra } });

test("top-up credits what Razorpay says was paid, not the amount the app sent", { skip }, async () => {
  const before = await wallet();
  const paid = razorpay.pay(razorpay.order(500), 500);
  const res = await topUp(paid, 100000);
  assert.equal(res.status, 200, res.text);
  assert.equal(await wallet(), before + 500, "credited the paid ₹500, not the claimed ₹1,00,000");
  assert.equal(res.body.data.transaction.amount, 500);
});

test("top-up for the honest amount still works and is recorded under the payment id (the ad flow looks it up that way)", { skip }, async () => {
  const before = await wallet();
  const paid = razorpay.pay(razorpay.order(250), 250);
  const res = await topUp(paid, 250, { businessId: "64b000000000000000000009", description: "Ad campaign payment" });
  assert.equal(res.status, 200, res.text);
  assert.equal(await wallet(), before + 250);
  const row = await Transaction.findOne({ transactionId: paid.paymentId, type: "CREDIT", userId: customer._id });
  assert.ok(row, "ledger row keyed by the Razorpay payment id");
  assert.equal(row.razorpayOrderId, paid.orderId);
});

test("an order Razorpay has not marked paid is not credited, whatever the signature says", { skip }, async () => {
  const before = await wallet();
  const orderId = razorpay.order(700);
  const paymentId = "pay_never_captured";
  const res = await topUp({ orderId, paymentId, signature: sign(orderId, paymentId) }, 700);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /not confirmed/);
  assert.equal(await wallet(), before);
});

test("a wrong signature, or missing payment details, is refused", { skip }, async () => {
  const before = await wallet();
  const paid = razorpay.pay(razorpay.order(100), 100);
  assert.equal((await topUp({ ...paid, signature: sign(paid.orderId, paid.paymentId, "someone else's secret") }, 100)).status, 400);
  assert.equal((await topUp({ orderId: paid.orderId }, 100)).status, 400);
  assert.equal((await topUp({}, 100)).status, 400);
  assert.equal(await wallet(), before);
});

test("the same payment cannot be credited twice, even when submitted at the same moment", { skip }, async () => {
  const before = await wallet();
  const paid = razorpay.pay(razorpay.order(300), 300);
  const results = await Promise.all(Array.from({ length: 6 }, () => topUp(paid, 300)));
  assert.equal(results.filter(r => r.status === 200).length, 1, results.map(r => r.status).join());
  assert.equal(await wallet(), before + 300);
  assert.equal(await Transaction.countDocuments({ transactionId: paid.paymentId }), 1);

  const replay = await topUp(paid, 300);
  assert.equal(replay.status, 400);
  assert.match(replay.body.message, /already been processed/);
});

test("one paid order cannot be credited again under a different payment id", { skip }, async () => {
  const before = await wallet();
  const orderId = razorpay.order(400);
  const first = razorpay.pay(orderId, 400);
  assert.equal((await topUp(first, 400)).status, 200);
  const second = { orderId, paymentId: "pay_second_for_same_order", signature: sign(orderId, "pay_second_for_same_order") };
  const res = await topUp(second, 400);
  assert.equal(res.status, 400);
  assert.equal(await wallet(), before + 400);
});

test("a customer cannot reserve a payment id by posting a debit with it", { skip }, async () => {
  const before = await wallet();
  const paid = razorpay.pay(razorpay.order(120), 120);
  await customer.constructor.updateOne({ _id: customer._id }, { $inc: { wallet: 50 } });
  const squat = await h.call("POST", "/api/transactions", { token, body: { type: "DEBIT", amount: 10, transactionId: paid.paymentId, paymentId: paid.paymentId } });
  assert.equal(squat.status, 200, "a debit of their own money is still allowed");
  const res = await topUp(paid, 120);
  assert.equal(res.status, 200, res.text);
  assert.equal(await wallet(), before + 50 - 10 + 120);
});

test("the ledger refuses a duplicate transaction id or order id at the database level", { skip }, async () => {
  const indexes = await Transaction.collection.indexes();
  const unique = field => indexes.find(index => index.unique && index.key[field] === 1);
  assert.ok(unique("transactionId"), "unique index on transactionId");
  assert.ok(unique("razorpayOrderId"), "unique index on razorpayOrderId");

  await Transaction.create({ type: "CREDIT", amount: 1, transactionId: "dup_check" });
  await assert.rejects(Transaction.create({ type: "CREDIT", amount: 1, transactionId: "dup_check" }), /E11000/);
  // Rows without an id (ad debits) are not constrained.
  await Transaction.create({ type: "DEBIT", amount: 1 });
  await Transaction.create({ type: "DEBIT", amount: 1 });
});

test("admins can still credit a customer by mobile number, as the admin panel does", { skip }, async () => {
  const before = await wallet();
  const res = await h.call("POST", "/api/transactions", {
    token: adminToken,
    body: { userId: String(customer.mobile), amount: 75, type: "CREDIT", walletType: "MAIN", description: "Initial wallet balance added by Admin" },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(await wallet(), before + 75);
});

test("a customer cannot use the admin path to credit anyone", { skip }, async () => {
  const before = await wallet();
  const res = await h.call("POST", "/api/transactions", { token, body: { userId: String(customer._id), amount: 5000, type: "CREDIT" } });
  assert.equal(res.status, 400);
  assert.equal(await wallet(), before);
});

test("anonymous callers cannot touch the wallet endpoints", { skip }, async () => {
  assert.equal((await h.call("POST", "/api/transactions", { body: { amount: 1, type: "CREDIT" } })).status, 401);
  assert.equal((await h.call("POST", "/api/createOrder", { body: { amount: 1 } })).status, 401);
  const order = await h.call("POST", "/api/createOrder", { token, body: { amount: 10 } });
  assert.equal(order.status, 201, "creating an order still works through the stand-in");
});
