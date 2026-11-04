const Transaction = require("../models/transtionModel");
const WhatsAppTransaction = require("../models/whatsappTransactionModel");
const InternalCampaign = require("../models/internalCampiagnModel");
const Business = require("../models/businessModel");
const User = require("../models/userModel");
const Studio = require("../modules/aiVideo/aiVideo.model");

// Every payment in the business belongs to one of these. The admin panel shows the label next to each
// payment so it is clear what the money was for.
const SERVICES = Object.freeze({
  META_ADS: "Meta Ads",
  WHATSAPP: "WhatsApp Business",
  AI_VIDEO: "AI Video",
  RCS: "RCS",
  WALLET_TOPUP: "Wallet top-up",
  OTHER: "Other",
});

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;
// A report reads at most this many rows per source; `truncated` tells the admin to narrow the dates.
const MAX_ROWS = 20000;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const money = n => Math.round((Number(n) || 0) * 100) / 100;
const escapeRegex = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function methodOfLedger(row) {
  const id = String(row.transactionId || "");
  if (/^pay_/i.test(id)) return "Razorpay";
  if (/admin/i.test(row.description || "")) return "Admin";
  return row.type === "CREDIT" ? "Other" : "Wallet";
}

/**
 * What a main-ledger row was for. Rows written from now on and rows written long ago are read the same
 * way, from what they carry: the ad it paid for, the AI video order id, the WhatsApp wallet, or the
 * Razorpay payment an ad was later created with (`fundedIds`).
 */
function classifyLedger(row, fundedIds) {
  const id = String(row.transactionId || "");
  const description = String(row.description || "");
  const direction = row.type === "CREDIT" ? "IN" : "OUT";
  const method = methodOfLedger(row);

  if (row.walletType === "WHATSAPP") {
    return { service: "WHATSAPP", direction, method, kind: direction === "IN" ? "WhatsApp wallet credit" : "WhatsApp wallet debit" };
  }
  if (/^aivideo_/i.test(id) || /^AI video\b/i.test(description)) {
    return { service: "AI_VIDEO", direction, method: "Wallet", kind: "AI video purchase from wallet" };
  }
  if (row.adsId || row.adsType) {
    return { service: "META_ADS", direction, method: "Wallet", kind: "Ad spend" };
  }
  if (direction === "IN" && id && fundedIds.has(id)) {
    return { service: "META_ADS", direction, method: "Razorpay", kind: "Ad payment (online)" };
  }
  if (/\brcs\b/i.test(description)) {
    return { service: "RCS", direction, method, kind: direction === "IN" ? "RCS payment" : "RCS usage" };
  }
  if (direction === "IN") {
    return { service: "WALLET_TOPUP", direction, method, kind: method === "Admin" ? "Admin credit to wallet" : "Wallet top-up" };
  }
  return { service: "OTHER", direction, method, kind: /order purchase/i.test(description) ? "Order purchase" : "Wallet debit" };
}

function classifyWhatsApp(row) {
  const direction = row.type === "CREDIT" ? "IN" : "OUT";
  if (row.mode === "PLAN_PURCHASE") return { service: "WHATSAPP", direction, method: "Wallet", kind: "WhatsApp plan purchase" };
  if (row.mode === "ADMIN") return { service: "WHATSAPP", direction, method: "Admin", kind: "Admin credit to WhatsApp wallet" };
  return { service: "WHATSAPP", direction, method: "Razorpay", kind: "WhatsApp wallet recharge" };
}

function classifyAiVideoOrder(order) {
  return {
    service: "AI_VIDEO",
    direction: "IN",
    method: "Razorpay",
    kind: order.kind === "plan" ? `AI video ${order.itemId || ""} plan${order.billing ? ` (${order.billing})` : ""}`.replace(/\s+/g, " ").trim() : "AI video credit pack",
  };
}

function parseDay(value, label, endOfDay) {
  if (value === undefined || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw httpError(400, `${label} must be a date like 2026-11-04.`);
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  // "2026-02-30" parses as 2 March, so the date has to come back out the way it went in.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw httpError(400, `${label} is not a real date.`);
  return date;
}

function dateRange({ from, to }, now = new Date()) {
  const end = parseDay(to, "The end date", true) || now;
  const start = parseDay(from, "The start date", false) || new Date(end.getTime() - DEFAULT_DAYS * DAY_MS);
  if (start > end) throw httpError(400, "The start date is after the end date.");
  if (end - start > MAX_DAYS * DAY_MS) throw httpError(400, `Choose a range of at most ${MAX_DAYS} days.`);
  return { start, end };
}

async function matchingUserIds(search) {
  const rx = new RegExp(escapeRegex(search), "i");
  const or = [{ name: rx }, { email: rx }];
  if (/^\d{3,10}$/.test(search)) or.push({ $expr: { $regexMatch: { input: { $toString: "$mobile" }, regex: escapeRegex(search) } } });
  return (await User.find({ $or: or }).select("_id").limit(500).lean()).map(user => user._id);
}

async function loadLedger({ start, end, search, userIds }) {
  const filter = { createdAt: { $gte: start, $lte: end } };
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ userId: { $in: userIds } }, { transactionId: rx }, { description: rx }];
  }
  const rows = await Transaction.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS + 1).lean();
  const truncated = rows.length > MAX_ROWS;
  if (truncated) rows.pop();

  // A Razorpay payment that paid for an ad is only recognisable by the ad that carries its payment id.
  const creditIds = [...new Set(rows.filter(row => row.type === "CREDIT" && row.transactionId).map(row => row.transactionId))];
  const fundedIds = new Set();
  for (let i = 0; i < creditIds.length; i += 1000) {
    const chunk = creditIds.slice(i, i + 1000);
    const ads = await InternalCampaign.find({ $or: [{ transactionId: { $in: chunk } }, { submissionKey: { $in: chunk } }] })
      .select("transactionId submissionKey")
      .lean();
    for (const ad of ads) {
      if (ad.transactionId) fundedIds.add(ad.transactionId);
      if (ad.submissionKey) fundedIds.add(ad.submissionKey);
    }
  }

  return {
    truncated,
    rows: rows.map(row => ({
      id: String(row._id),
      source: "ledger",
      ...classifyLedger(row, fundedIds),
      amount: money(row.amount),
      reference: row.transactionId || "",
      description: row.description || "",
      createdAt: row.createdAt,
      userId: row.userId ? String(row.userId) : null,
      businessId: row.businessId ? String(row.businessId) : null,
    })),
  };
}

async function loadWhatsApp({ start, end, search, userIds }) {
  const filter = { createdAt: { $gte: start, $lte: end } };
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ userId: { $in: userIds } }, { transactionId: rx }, { description: rx }];
  }
  const rows = await WhatsAppTransaction.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS + 1).lean();
  const truncated = rows.length > MAX_ROWS;
  if (truncated) rows.pop();
  return {
    truncated,
    rows: rows.map(row => ({
      id: String(row._id),
      source: "whatsapp",
      ...classifyWhatsApp(row),
      amount: money(row.amount),
      reference: row.transactionId || "",
      description: row.description || "",
      createdAt: row.createdAt,
      userId: row.userId ? String(row.userId) : null,
      businessId: null,
    })),
  };
}

// Only orders paid through Razorpay: one paid from the wallet already has its own row in the main ledger.
async function loadAiVideoOrders({ start, end, search, userIds }) {
  const match = { "orders.status": "paid", "orders.method": "razorpay" };
  const rows = await Studio.aggregate([
    { $match: { "orders.status": "paid" } },
    { $unwind: "$orders" },
    { $match: { ...match, "orders.paidAt": { $gte: start, $lte: end }, ...(search ? { $or: [{ userId: { $in: userIds } }, { "orders.razorpayPaymentId": new RegExp(escapeRegex(search), "i") }] } : {}) } },
    { $sort: { "orders.paidAt": -1 } },
    { $limit: MAX_ROWS + 1 },
    { $project: { userId: 1, businessId: 1, order: "$orders" } },
  ]);
  const truncated = rows.length > MAX_ROWS;
  if (truncated) rows.pop();
  return {
    truncated,
    rows: rows.map(row => ({
      id: `${row._id}:${row.order.id}`,
      source: "ai_video_order",
      ...classifyAiVideoOrder(row.order),
      amount: money(row.order.price),
      reference: row.order.razorpayPaymentId || "",
      description: `AI video: ${row.order.kind === "plan" ? `${row.order.itemId} plan` : `${row.order.credits} credits`}${row.order.methodLabel ? ` (${row.order.methodLabel})` : ""}`,
      createdAt: row.order.paidAt || row.order.createdAt,
      userId: row.userId ? String(row.userId) : null,
      businessId: row.businessId && /^[0-9a-f]{24}$/i.test(String(row.businessId)) ? String(row.businessId) : null,
    })),
  };
}

function summarise(rows) {
  const byService = Object.fromEntries(Object.keys(SERVICES).map(key => [key, { service: key, label: SERVICES[key], count: 0, moneyIn: 0, spent: 0 }]));
  for (const row of rows) {
    const line = byService[row.service];
    line.count += 1;
    if (row.direction === "IN") line.moneyIn += row.amount;
    else line.spent += row.amount;
  }
  for (const line of Object.values(byService)) {
    line.moneyIn = money(line.moneyIn);
    line.spent = money(line.spent);
  }
  return Object.values(byService);
}

/**
 * The admin's view of payments: every source in one list, each row labelled with the service it was for.
 * Filters: service, direction (IN/OUT), search (customer name, e-mail, phone, payment id), from/to (a
 * date each, last 30 days when not given). `summary` covers the whole date range and search, whatever
 * the service filter, so the totals per service stay visible while one service is picked.
 */
async function report(query = {}, now = new Date()) {
  const { service, direction } = query;
  if (service && !SERVICES[service]) throw httpError(400, "Choose one of the listed services.");
  if (direction && !["IN", "OUT"].includes(direction)) throw httpError(400, "Direction must be IN or OUT.");
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const { start, end } = dateRange(query, now);
  const search = String(query.search || "").trim().slice(0, 80);
  const userIds = search ? await matchingUserIds(search) : [];

  const sources = await Promise.all([
    loadLedger({ start, end, search, userIds }),
    loadWhatsApp({ start, end, search, userIds }),
    loadAiVideoOrders({ start, end, search, userIds }),
  ]);
  const all = sources.flatMap(source => source.rows).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const filtered = all.filter(row => (!service || row.service === service) && (!direction || row.direction === direction));
  const slice = filtered.slice((page - 1) * limit, page * limit);

  const [users, businesses] = await Promise.all([
    User.find({ _id: { $in: [...new Set(slice.map(row => row.userId).filter(Boolean))] } }).select("name mobile email").lean(),
    Business.find({ _id: { $in: [...new Set(slice.map(row => row.businessId).filter(Boolean))] } }).select("businessName").lean(),
  ]);
  const userById = new Map(users.map(user => [String(user._id), user]));
  const businessById = new Map(businesses.map(business => [String(business._id), business.businessName]));

  return {
    range: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
    truncated: sources.some(source => source.truncated),
    page,
    limit,
    total: filtered.length,
    pageCount: Math.max(1, Math.ceil(filtered.length / limit)),
    summary: summarise(all),
    rows: slice.map(row => {
      const user = userById.get(row.userId);
      return {
        id: row.id,
        source: row.source,
        service: row.service,
        serviceLabel: SERVICES[row.service],
        kind: row.kind,
        direction: row.direction,
        method: row.method,
        amount: row.amount,
        reference: row.reference,
        description: row.description,
        createdAt: row.createdAt,
        user: user ? { id: String(user._id), name: user.name || "", mobile: user.mobile ?? null, email: user.email || "" } : null,
        businessName: (row.businessId && businessById.get(row.businessId)) || "",
      };
    }),
  };
}

module.exports = { SERVICES, classifyLedger, classifyWhatsApp, classifyAiVideoOrder, report, dateRange };
