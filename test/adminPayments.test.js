// The admin's payments report labels every payment with the service it was for (Meta Ads, WhatsApp Business,
// AI Video, RCS ...) and totals them per service. Real app, throwaway local mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;
let adminToken;
let customerToken;
let payer;
let Transaction;
let WhatsAppTransaction;
let InternalCampaign;
let Studio;
let Staff;

const get = (query = "", token = adminToken) => h.call("GET", `/api/admin/payments${query}`, { token });
const labelOf = (rows, reference) => rows.find(row => row.reference === reference);
const day = offset => new Date(Date.now() - offset * 24 * 60 * 60 * 1000);

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  Transaction = require("../src/models/transtionModel");
  WhatsAppTransaction = require("../src/models/whatsappTransactionModel");
  InternalCampaign = require("../src/models/internalCampiagnModel");
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  Staff = require("../src/models/staffModel");
  const admin = await fixtures.makeAdmin();
  payer = await fixtures.makeUser({ name: "Priya Sharma", email: "priya@example.test" });
  const bystander = await fixtures.makeUser({ name: "Rahul Verma" });
  adminToken = fixtures.tokenFor(admin);
  customerToken = fixtures.tokenFor(payer);
  const shop = await fixtures.makeBusiness(payer, { businessName: "Priya Boutique" });
  const adId = new h.mongoose.Types.ObjectId();
  await InternalCampaign.collection.insertOne({ transactionId: "pay_ad1", submissionKey: "pay_ad1", businessId: shop._id, createdAt: new Date() });

  const u = payer._id;
  await Transaction.create([
    { type: "CREDIT", amount: 2360, userId: u, transactionId: "pay_ad1", description: "Wallet Recharge (order_a1)", createdAt: day(1) },
    { type: "DEBIT", amount: 2360, userId: u, adsId: adId, businessId: shop._id, createdAt: day(1) },
    { type: "CREDIT", amount: 500, userId: u, transactionId: "pay_top1", description: "Wallet Recharge (order_t1)", createdAt: day(2) },
    { type: "DEBIT", amount: 600, userId: u, transactionId: "aivideo_ord1", description: "AI video: 100 credits", createdAt: day(3) },
    { type: "CREDIT", amount: 1000, userId: u, walletType: "WHATSAPP", transactionId: "ADMWA1", description: "WhatsApp Wallet Credit (Admin)", createdAt: day(4) },
    { type: "CREDIT", amount: 300, userId: bystander._id, transactionId: "ADM1", description: "Main Wallet Credit (Admin)", createdAt: day(5) },
    { type: "DEBIT", amount: 99, userId: u, description: "Order purchase - ORD1", createdAt: day(6) },
    { type: "DEBIT", amount: 50, userId: u, description: "RCS campaign sent (100 messages)", createdAt: day(7) },
    { type: "CREDIT", amount: 111, userId: u, transactionId: "pay_old", description: "Wallet Recharge (order_old)", createdAt: day(90) },
  ]);
  await WhatsAppTransaction.create([
    { type: "CREDIT", amount: 2000, userId: u, transactionId: "pay_wa1", mode: "RAZORPAY", description: "Razorpay wallet recharge (order_w1)", createdAt: day(2) },
    { type: "DEBIT", amount: 999, userId: u, transactionId: "wa_plan_1", mode: "PLAN_PURCHASE", description: "Plan purchased: Growth", createdAt: day(2) },
    { type: "CREDIT", amount: 100, userId: u, transactionId: "wa_admin_1", mode: "ADMIN", description: "Admin WhatsApp wallet credit", createdAt: day(3) },
  ]);
  await Studio.collection.insertOne({
    userId: u,
    businessId: String(shop._id),
    credits: 0,
    orders: [
      { id: "o1", kind: "pack", itemId: "pack_100", price: 600, credits: 100, method: "razorpay", status: "paid", razorpayPaymentId: "pay_ai1", methodLabel: "Visa 1111", paidAt: day(1), createdAt: day(1) },
      { id: "o2", kind: "plan", itemId: "pro", billing: "monthly", price: 1800, credits: 300, method: "wallet", status: "paid", paidAt: day(1), createdAt: day(1) },
      { id: "o3", kind: "pack", itemId: "pack_500", price: 3000, credits: 500, method: "razorpay", status: "pending_payment", createdAt: day(1) },
    ],
  });
});

after(async () => {
  if (h) await h.close();
});

test("every payment is labelled with the service it was for", { skip }, async () => {
  const response = await get("?limit=100");
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const rows = response.body.data.rows;
  const expect = [
    ["pay_ad1", "META_ADS", "Ad payment (online)", "IN", "Razorpay"],
    ["pay_top1", "WALLET_TOPUP", "Wallet top-up", "IN", "Razorpay"],
    ["aivideo_ord1", "AI_VIDEO", "AI video purchase from wallet", "OUT", "Wallet"],
    ["ADMWA1", "WHATSAPP", "WhatsApp wallet credit", "IN", "Admin"],
    ["ADM1", "WALLET_TOPUP", "Admin credit to wallet", "IN", "Admin"],
    ["pay_wa1", "WHATSAPP", "WhatsApp wallet recharge", "IN", "Razorpay"],
    ["wa_plan_1", "WHATSAPP", "WhatsApp plan purchase", "OUT", "Wallet"],
    ["wa_admin_1", "WHATSAPP", "Admin credit to WhatsApp wallet", "IN", "Admin"],
    ["pay_ai1", "AI_VIDEO", "AI video credit pack", "IN", "Razorpay"],
  ];
  for (const [reference, service, kind, direction, method] of expect) {
    const row = labelOf(rows, reference);
    assert.ok(row, `${reference} is listed`);
    assert.deepEqual([row.service, row.kind, row.direction, row.method], [service, kind, direction, method], reference);
  }
  const adSpend = rows.find(row => row.kind === "Ad spend");
  assert.deepEqual([adSpend.service, adSpend.serviceLabel, adSpend.direction, adSpend.amount, adSpend.businessName], ["META_ADS", "Meta Ads", "OUT", 2360, "Priya Boutique"]);
  assert.equal(rows.find(row => /Order purchase/.test(row.description)).service, "OTHER");
  assert.equal(rows.find(row => /^RCS campaign/.test(row.description)).service, "RCS");
  assert.equal(rows.find(row => /^RCS campaign/.test(row.description)).serviceLabel, "RCS");
});

test("an AI video order paid from the wallet is not listed twice, and an unpaid one is not listed at all", { skip }, async () => {
  const rows = (await get("?limit=100")).body.data.rows;
  assert.equal(rows.filter(row => row.service === "AI_VIDEO").length, 2, "one wallet debit (ledger) and one Razorpay order");
  assert.ok(!rows.some(row => row.amount === 1800), "the wallet-paid plan order has no row of its own");
  assert.ok(!rows.some(row => row.amount === 3000), "pending_payment is not a payment");
});

test("totals per service say what came in and what was spent", { skip }, async () => {
  const { summary, total, range } = (await get("?limit=100")).body.data;
  const by = Object.fromEntries(summary.map(line => [line.service, line]));
  assert.deepEqual([by.META_ADS.count, by.META_ADS.moneyIn, by.META_ADS.spent], [2, 2360, 2360]);
  assert.deepEqual([by.WHATSAPP.count, by.WHATSAPP.moneyIn, by.WHATSAPP.spent], [4, 3100, 999]);
  assert.deepEqual([by.AI_VIDEO.count, by.AI_VIDEO.moneyIn, by.AI_VIDEO.spent], [2, 600, 600]);
  assert.deepEqual([by.WALLET_TOPUP.count, by.WALLET_TOPUP.moneyIn], [2, 800]);
  assert.deepEqual([by.RCS.count, by.RCS.spent], [1, 50]);
  assert.equal(by.OTHER.spent, 99);
  assert.equal(summary.length, 6, "every service is listed, even with nothing in it");
  assert.equal(summary.reduce((sum, line) => sum + line.count, 0), total);
  assert.ok(range.from < range.to);
});

test("it can show one service, one direction, a date range, or search by customer or payment id", { skip }, async () => {
  const meta = (await get("?service=META_ADS&limit=100")).body.data;
  assert.deepEqual(meta.rows.map(row => row.service), ["META_ADS", "META_ADS"]);
  assert.equal(meta.summary.find(line => line.service === "WHATSAPP").count, 4, "totals still cover every service");

  const out = (await get("?direction=OUT&limit=100")).body.data.rows;
  assert.ok(out.length > 0 && out.every(row => row.direction === "OUT"));

  const wide = (await get(`?from=${day(100).toISOString().slice(0, 10)}&limit=100`)).body.data.rows;
  assert.ok(wide.some(row => row.reference === "pay_old"), "an old payment appears once the range reaches it");
  assert.ok(!(await get("?limit=100")).body.data.rows.some(row => row.reference === "pay_old"), "the last 30 days by default");

  const byName = (await get("?search=priya&limit=100")).body.data.rows;
  assert.ok(byName.length > 0 && !byName.some(row => row.reference === "ADM1"), "Rahul's payment is not Priya's");
  assert.ok(byName.every(row => row.user.name === "Priya Sharma"));
  const byId = (await get("?search=pay_ai1")).body.data.rows;
  assert.deepEqual(byId.map(row => row.reference), ["pay_ai1"]);
});

test("pages are cut on the server and newest first", { skip }, async () => {
  const first = (await get("?limit=4&page=1")).body.data;
  const second = (await get("?limit=4&page=2")).body.data;
  assert.equal(first.rows.length, 4);
  assert.ok(first.pageCount >= 3);
  assert.ok(new Date(first.rows[0].createdAt) >= new Date(first.rows[3].createdAt));
  assert.ok(new Date(first.rows[3].createdAt) >= new Date(second.rows[0].createdAt));
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 8, "no row twice");
});

test("bad filters are refused with a reason", { skip }, async () => {
  for (const [query, pattern] of [
    ["?service=BANANA", /listed services/],
    ["?direction=SIDEWAYS", /IN or OUT/],
    ["?from=yesterday", /date like/],
    ["?from=2026-02-30", /real date/],
    ["?from=2026-06-01&to=2026-05-01", /after the end/],
    ["?from=2020-01-01&to=2026-01-01", /at most 366/],
  ]) {
    const response = await get(query);
    assert.equal(response.status, 400, query);
    assert.match(response.body.message, pattern, query);
  }
});

test("only an admin with the Transaction permission can read it", { skip }, async () => {
  assert.equal((await get("", customerToken)).status, 401);
  assert.equal((await h.call("GET", "/api/admin/payments")).status, 401);

  const staffUser = await fixtures.makeAdmin({ email: "staff-pay@example.test" });
  await Staff.create({ userId: staffUser._id, role: "STAFF", permissions: ["LEAD"] });
  assert.equal((await get("", fixtures.tokenFor(staffUser))).status, 403);
  await Staff.updateOne({ userId: staffUser._id }, { permissions: ["TRANSACTION"] });
  assert.equal((await get("", fixtures.tokenFor(staffUser))).status, 200);
});
