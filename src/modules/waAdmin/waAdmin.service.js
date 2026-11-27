// WhatsApp super admin: the whole WhatsApp business at a glance, every customer in full, and the
// actions that change a customer's money, plan, features or keys. Every change is audited.
// Secrets (Meta tokens, CRM credentials, key hashes) are never selected here.
const mongoose = require("mongoose");
const User = require("../../models/userModel");
const Account = require("../../models/whatsappAccountModel");
const Message = require("../../models/whatsappMessageModel");
const Transaction = require("../../models/whatsappTransactionModel");
const Subscription = require("../../models/whatsappSubscriptionModel");
const Plan = require("../../models/whatsappPlanModel");
const Template = require("../../models/whatsappTemplateModel");
const Campaign = require("../../models/whatsappCampaignModel");
const Contact = require("../../models/whatsappContactModel");
const Group = require("../../models/whatsappContactGroupModel");
const Label = require("../../models/whatsappLabelModel");
const Link = require("../../models/whatsappLinkModel");
const Flow = require("../../models/whatsappFlowModel");
const Integration = require("../../models/whatsappIntegrationModel");
const Key = require("../../models/whatsappApiKeyModel");
const Call = require("../../models/whatsappApiCallModel");
const Hook = require("../../models/whatsappDeveloperWebhookModel");
const Support = require("../../models/whatsappSupportModel");
const ChatbotSub = require("../../models/whatsappChatbotSubscriptionModel");
const Control = require("../../models/whatsappControlModel");
const Audit = require("../../models/whatsappAdminAuditModel");
const controls = require("../../services/whatsappControls");
const sendGuard = require("../../services/whatsappSendGuard");
const axios = require("axios");
const contract = require("../../services/developerContract");

const DAY = 24 * 60 * 60 * 1000;
const CREDIT_FIELDS = { MARKETING: "marketingCredits", UTILITY: "utilityCredits", AUTHENTICATION: "authenticationCredits", SERVICE: "serviceCredits" };
const ACCOUNT_FIELDS = "userId phoneNumber verifiedName businessName qualityRating qualityEvent messagingLimit accountReviewStatus phoneStatus codeVerificationStatus status billingMode onboardingMode connectedVia phoneNumberId wabaId disconnectionReason healthEvents createdAt updatedAt";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function oid(value, label = "customer") {
  if (!mongoose.isValidObjectId(value)) throw fail(404, `Unknown ${label}`);
  return new mongoose.Types.ObjectId(String(value));
}

function page(query = {}, max = 100) {
  const limit = Math.min(max, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const current = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { limit, current, skip: (current - 1) * limit };
}

function paged(rows, total, p) {
  return { rows, total, currentPage: p.current, totalPages: Math.max(1, Math.ceil(total / p.limit)) };
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const rupees = (paise) => Number(((paise || 0) / 100).toFixed(2));
const round2 = (n) => Number(Number(n || 0).toFixed(2));

function personOf(user) {
  if (!user) return null;
  return { id: String(user._id), name: user.name || null, mobile: user.mobile ?? null, email: user.email || null, disabled: Boolean(user.disable) };
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function lastDays(n) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKey(new Date(today.getTime() - i * DAY)));
  return out;
}

async function record(admin, action, userId, details = {}) {
  await Audit.create({
    adminId: admin?._id || null,
    adminName: admin?.name || admin?.email || "Admin",
    action,
    userId: userId || null,
    details,
  });
}

// userId → account (one WABA per customer), and phoneNumberId → userId.
async function accountsFor(userIds) {
  const rows = await Account.find({ userId: { $in: userIds } }).select(ACCOUNT_FIELDS).lean();
  return new Map(rows.map((a) => [String(a.userId), a]));
}

async function userIdsByPhoneNumberIds(ids) {
  const rows = await Account.find({ phoneNumberId: { $in: ids.filter(Boolean) } }).select("userId phoneNumberId phoneNumber verifiedName").lean();
  return new Map(rows.map((a) => [a.phoneNumberId, a]));
}

/* ------------------------------------------------------------------ Overview */
async function overview() {
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const since14 = new Date(now - 13 * DAY);
  since14.setUTCHours(0, 0, 0, 0);
  const since1 = new Date(now - DAY);

  const [
    accounts, quality, perDay, last24, topSenders, failures, topups, planSales, messageSpend,
    walletHeld, activeSubs, campaigns, templatesPending, supportOpen, integrationErrors,
    activeKeys, apiCalls24, suspended, customised, contacts,
  ] = await Promise.all([
    Account.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Account.aggregate([{ $match: { status: "CONNECTED" } }, { $group: { _id: { $ifNull: ["$qualityRating", "UNKNOWN"] }, count: { $sum: 1 } } }]),
    Message.aggregate([
      { $match: { createdAt: { $gte: since14 } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, direction: "$direction", status: "$status" }, count: { $sum: 1 } } },
    ]),
    Message.aggregate([
      { $match: { createdAt: { $gte: since1 } } },
      { $group: { _id: { direction: "$direction", status: "$status" }, count: { $sum: 1 } } },
    ]),
    Message.aggregate([
      { $match: { createdAt: { $gte: since30 }, direction: "OUTBOUND" } },
      { $group: { _id: "$phoneNumberId", sent: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } } } },
      { $sort: { sent: -1 } }, { $limit: 8 },
    ]),
    Message.find({ status: "FAILED", direction: "OUTBOUND" }).sort({ createdAt: -1 }).limit(8)
      .select("phoneNumberId to templateName errorCode errorMessage createdAt source").lean(),
    Transaction.aggregate([{ $match: { type: "CREDIT", mode: "RAZORPAY", createdAt: { $gte: since30 } } }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    Transaction.aggregate([{ $match: { mode: "PLAN_PURCHASE", type: "DEBIT", createdAt: { $gte: since30 } } }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    Message.aggregate([{ $match: { billSource: "wallet", billingState: { $in: ["reserved", "settled"] }, createdAt: { $gte: since30 } } }, { $group: { _id: null, paise: { $sum: "$billPaise" }, count: { $sum: 1 } } }]),
    User.aggregate([{ $match: { whatsappWallet: { $gt: 0 } } }, { $group: { _id: null, amount: { $sum: "$whatsappWallet" }, count: { $sum: 1 } } }]),
    Subscription.countDocuments({ status: "ACTIVE", endDate: { $gt: new Date() } }),
    Campaign.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Template.countDocuments({ status: "PENDING" }),
    Support.countDocuments({ status: { $in: ["OPEN", "IN_PROGRESS"] } }),
    Integration.countDocuments({ "stats.lastError": { $nin: ["", null] } }),
    Key.countDocuments({ revokedAt: null }),
    Call.countDocuments({ createdAt: { $gte: since1 } }),
    Control.countDocuments({ suspended: true }),
    Control.countDocuments({ $expr: { $gt: [{ $size: { $objectToArray: { $ifNull: ["$features", {}] } } }, 0] } }),
    Contact.estimatedDocumentCount(),
  ]);

  const series = new Map(lastDays(14).map((d) => [d, { day: d, sent: 0, delivered: 0, read: 0, failed: 0, received: 0 }]));
  for (const row of perDay) {
    const slot = series.get(row._id.day);
    if (!slot) continue;
    if (row._id.direction === "INBOUND") slot.received += row.count;
    else if (row._id.status === "FAILED") slot.failed += row.count;
    else if (row._id.status === "READ") slot.read += row.count;
    else if (row._id.status === "DELIVERED") slot.delivered += row.count;
    else slot.sent += row.count;
  }
  const day = { sent: 0, delivered: 0, read: 0, failed: 0, received: 0, queued: 0 };
  for (const row of last24) {
    if (row._id.direction === "INBOUND") day.received += row.count;
    else if (row._id.status === "FAILED") day.failed += row.count;
    else if (row._id.status === "READ") day.read += row.count;
    else if (row._id.status === "DELIVERED") day.delivered += row.count;
    else if (row._id.status === "QUEUED") day.queued += row.count;
    else day.sent += row.count;
  }
  const outbound24 = day.sent + day.delivered + day.read + day.failed + day.queued;

  const byPn = await userIdsByPhoneNumberIds([...topSenders.map((r) => r._id), ...failures.map((f) => f.phoneNumberId)]);
  const owners = await User.find({ _id: { $in: [...byPn.values()].map((a) => a.userId) } }).select("name mobile email disable").lean();
  const ownerMap = new Map(owners.map((u) => [String(u._id), u]));
  const who = (pn) => {
    const a = byPn.get(pn);
    return a ? { userId: String(a.userId), user: personOf(ownerMap.get(String(a.userId))), phoneNumber: a.phoneNumber, verifiedName: a.verifiedName } : { userId: null, user: null, phoneNumber: null, verifiedName: null };
  };

  const statusCount = Object.fromEntries(accounts.map((r) => [r._id || "UNKNOWN", r.count]));
  const attention = await Account.find({ $or: [{ status: "DISCONNECTED" }, { qualityRating: { $in: ["RED", "YELLOW"] } }, { accountReviewStatus: "REJECTED" }] })
    .sort({ updatedAt: -1 }).limit(6).select(ACCOUNT_FIELDS).lean();
  const attentionOwners = await User.find({ _id: { $in: attention.map((a) => a.userId) } }).select("name mobile email disable").lean();
  const attentionMap = new Map(attentionOwners.map((u) => [String(u._id), u]));

  return {
    generatedAt: new Date(),
    numbers: {
      total: accounts.reduce((s, r) => s + r.count, 0),
      connected: statusCount.CONNECTED || 0,
      disconnected: statusCount.DISCONNECTED || 0,
      quality: Object.fromEntries(quality.map((r) => [r._id, r.count])),
    },
    last24h: { ...day, outbound: outbound24, deliveryRate: outbound24 ? round2(((day.delivered + day.read) / outbound24) * 100) : null, failureRate: outbound24 ? round2((day.failed / outbound24) * 100) : null },
    perDay: [...series.values()],
    money: {
      walletTopups30d: round2(topups[0]?.amount), walletTopupCount30d: topups[0]?.count || 0,
      planSales30d: round2(planSales[0]?.amount), planSaleCount30d: planSales[0]?.count || 0,
      messageSpend30d: rupees(messageSpend[0]?.paise), paidMessages30d: messageSpend[0]?.count || 0,
      walletHeld: round2(walletHeld[0]?.amount), walletsWithBalance: walletHeld[0]?.count || 0,
    },
    activeSubscriptions: activeSubs,
    campaigns: Object.fromEntries(campaigns.map((r) => [r._id || "UNKNOWN", r.count])),
    templatesPending,
    supportOpen,
    integrationErrors,
    api: { activeKeys, calls24h: apiCalls24 },
    controls: { suspended, customised },
    contacts,
    topSenders: topSenders.map((r) => ({ ...who(r._id), sent: r.sent, failed: r.failed })),
    recentFailures: failures.map((f) => ({ ...who(f.phoneNumberId), to: f.to, templateName: f.templateName || "", errorCode: f.errorCode || null, errorMessage: f.errorMessage || "", source: f.source || "", at: f.createdAt })),
    numbersNeedingAttention: attention.map((a) => ({ userId: String(a.userId), user: personOf(attentionMap.get(String(a.userId))), phoneNumber: a.phoneNumber, verifiedName: a.verifiedName, status: a.status, qualityRating: a.qualityRating, accountReviewStatus: a.accountReviewStatus, reason: a.disconnectionReason || a.qualityEvent || "" })),
  };
}

/* ------------------------------------------------------------------ Customers */
async function customerIds() {
  const [fromAccounts, fromWallet, fromSubs, fromControls] = await Promise.all([
    Account.distinct("userId"),
    User.distinct("_id", { whatsappWallet: { $gt: 0 } }),
    Subscription.distinct("userId"),
    Control.distinct("userId"),
  ]);
  return [...new Set([...fromAccounts, ...fromWallet, ...fromSubs, ...fromControls].map(String))].map((id) => new mongoose.Types.ObjectId(id));
}

async function customers(query = {}) {
  const p = page(query);
  const ids = await customerIds();
  const filter = { _id: { $in: ids } };
  const q = String(query.q || "").trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const digits = q.replace(/\D/g, "");
    const byNumber = digits.length >= 4 ? await Account.distinct("userId", { phoneNumber: { $regex: escapeRegex(digits.slice(-10)).split("").join("\\D*") } }) : [];
    const or = [{ name: rx }, { email: rx }, { _id: { $in: byNumber } }];
    if (digits.length >= 4) or.push({ $expr: { $regexMatch: { input: { $toString: "$mobile" }, regex: escapeRegex(digits) } } });
    if (mongoose.isValidObjectId(q)) or.push({ _id: new mongoose.Types.ObjectId(q) });
    filter.$or = or;
  }
  const status = String(query.status || "");
  if (status === "suspended") filter._id = { $in: await Control.distinct("userId", { suspended: true, userId: { $in: ids } }) };
  if (status === "connected" || status === "disconnected") filter._id = { $in: await Account.distinct("userId", { status: status.toUpperCase(), userId: { $in: ids } }) };
  if (status === "no-number") {
    const withNumber = new Set((await Account.distinct("userId")).map(String));
    filter._id = { $in: ids.filter((id) => !withNumber.has(String(id))) };
  }
  if (status === "low-quality") filter._id = { $in: await Account.distinct("userId", { qualityRating: { $in: ["RED", "YELLOW"] }, userId: { $in: ids } }) };

  const sort = query.sort === "wallet" ? { whatsappWallet: -1 } : query.sort === "name" ? { name: 1 } : { createdAt: -1 };
  const [users, total] = await Promise.all([
    User.find(filter).sort(sort).skip(p.skip).limit(p.limit).select("name mobile email disable whatsappWallet createdAt").lean(),
    User.countDocuments(filter),
  ]);
  const userIds = users.map((u) => u._id);
  const since30 = new Date(Date.now() - 30 * DAY);
  const [accounts, subs, ctrlDocs] = await Promise.all([
    accountsFor(userIds),
    Subscription.find({ userId: { $in: userIds }, status: "ACTIVE", endDate: { $gt: new Date() } }).sort({ endDate: -1 }).lean(),
    Control.find({ userId: { $in: userIds } }).lean(),
  ]);
  const plans = new Map((await Plan.find({ _id: { $in: subs.map((s) => s.planId) } }).select("title").lean()).map((pl) => [String(pl._id), pl.title]));
  const pnIds = [...accounts.values()].map((a) => a.phoneNumberId).filter(Boolean);
  const usage = await Message.aggregate([
    { $match: { phoneNumberId: { $in: pnIds }, createdAt: { $gte: since30 } } },
    { $group: { _id: "$phoneNumberId", sent: { $sum: { $cond: [{ $eq: ["$direction", "OUTBOUND"] }, 1, 0] } }, received: { $sum: { $cond: [{ $eq: ["$direction", "INBOUND"] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } }, last: { $max: "$createdAt" } } },
  ]);
  const usageMap = new Map(usage.map((u) => [u._id, u]));
  const subMap = new Map();
  for (const s of subs) if (!subMap.has(String(s.userId))) subMap.set(String(s.userId), s);
  const ctrlMap = new Map(ctrlDocs.map((c) => [String(c.userId), c]));

  const rows = users.map((u) => {
    const id = String(u._id);
    const a = accounts.get(id);
    const s = subMap.get(id);
    const use = a ? usageMap.get(a.phoneNumberId) : null;
    const c = ctrlMap.get(id);
    return {
      id,
      user: personOf(u),
      wallet: round2(u.whatsappWallet),
      number: a ? { phoneNumber: a.phoneNumber, verifiedName: a.verifiedName, status: a.status, qualityRating: a.qualityRating, messagingLimit: a.messagingLimit, billingMode: a.billingMode } : null,
      plan: s ? { title: plans.get(String(s.planId)) || "Plan", endDate: s.endDate } : null,
      usage30d: { sent: use?.sent || 0, received: use?.received || 0, failed: use?.failed || 0 },
      lastActivity: use?.last || null,
      suspended: Boolean(c?.suspended),
      overrides: Object.values(c?.features || {}).filter((v) => typeof v === "boolean").length,
      joinedAt: u.createdAt,
    };
  });
  return paged(rows, total, p);
}

async function customer(userId) {
  const id = oid(userId);
  const user = await User.findById(id).select("name mobile email disable whatsappWallet userType createdAt").lean();
  if (!user) throw fail(404, "Customer not found");
  const since30 = new Date(Date.now() - 30 * DAY);
  const account = await Account.findOne({ userId: id }).select(ACCOUNT_FIELDS).lean();
  const pn = account?.phoneNumberId || "__none__";

  const [
    transactions, subs, chatbotSub, templates, campaigns, recentCampaigns, contacts, groups, labels, links,
    flows, integrations, keys, apiCalls30, hook, apiPackage, tickets, usage, byCategory, perDay, failures, control, effective, audit, conversations,
  ] = await Promise.all([
    Transaction.find({ userId: id }).sort({ createdAt: -1 }).limit(15).lean(),
    Subscription.find({ userId: id }).sort({ createdAt: -1 }).limit(5).lean(),
    ChatbotSub.findOne({ userId: id }).sort({ createdAt: -1 }).lean(),
    Template.aggregate([{ $match: { createdBy: id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Campaign.aggregate([{ $match: { createdBy: id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Campaign.find({ createdBy: id }).sort({ createdAt: -1 }).limit(6).select("name status totalContacts stats scheduledAt createdAt").lean(),
    Contact.countDocuments({ userId: id }),
    Group.countDocuments({ userId: id }),
    Label.countDocuments({ userId: id }),
    Link.countDocuments({ userId: id }),
    Flow.aggregate([{ $match: { userId: id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Integration.find({ userId: id }).select("app label config.paused config.needsReconnect stats mappings.enabled createdAt").lean(),
    Key.find({ userId: id }).sort({ createdAt: -1 }).select("name prefix last4 service access lastUsedAt callCount revokedAt createdAt").lean(),
    Call.countDocuments({ userId: id, createdAt: { $gte: since30 } }),
    Hook.findOne({ userId: id }).select("url enabled").lean(),
    contract.read(id),
    Support.find({ userId: id }).sort({ createdAt: -1 }).limit(5).select("subject category status priority createdAt").lean(),
    Message.aggregate([{ $match: { phoneNumberId: pn, createdAt: { $gte: since30 } } }, { $group: { _id: { direction: "$direction", status: "$status" }, count: { $sum: 1 } } }]),
    Message.aggregate([{ $match: { phoneNumberId: pn, direction: "OUTBOUND", createdAt: { $gte: since30 } } }, { $group: { _id: { $ifNull: ["$billCategory", "UNKNOWN"] }, count: { $sum: 1 }, paise: { $sum: { $cond: [{ $eq: ["$billSource", "wallet"] }, "$billPaise", 0] } } } }]),
    Message.aggregate([
      { $match: { phoneNumberId: pn, createdAt: { $gte: new Date(Date.now() - 13 * DAY) } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, direction: "$direction", failed: { $eq: ["$status", "FAILED"] } }, count: { $sum: 1 } } },
    ]),
    Message.find({ phoneNumberId: pn, status: "FAILED" }).sort({ createdAt: -1 }).limit(6).select("to templateName errorCode errorMessage createdAt").lean(),
    controls.getControl(id, { fresh: true }),
    controls.effective(id),
    Audit.find({ userId: id }).sort({ at: -1 }).limit(15).lean(),
    Message.distinct("to", { phoneNumberId: pn, direction: "INBOUND", createdAt: { $gte: since30 } }).then((r) => r.length),
  ]);

  const plans = new Map((await Plan.find({ _id: { $in: subs.map((s) => s.planId) } }).select("title price").lean()).map((pl) => [String(pl._id), pl]));
  const counts = (rows) => Object.fromEntries(rows.map((r) => [r._id || "UNKNOWN", r.count]));
  const traffic = { sent: 0, delivered: 0, read: 0, failed: 0, queued: 0, received: 0 };
  for (const r of usage) {
    if (r._id.direction === "INBOUND") traffic.received += r.count;
    else traffic[String(r._id.status || "SENT").toLowerCase()] = (traffic[String(r._id.status || "SENT").toLowerCase()] || 0) + r.count;
  }
  const series = new Map(lastDays(14).map((d) => [d, { day: d, sent: 0, failed: 0, received: 0 }]));
  for (const r of perDay) {
    const slot = series.get(r._id.day);
    if (!slot) continue;
    if (r._id.direction === "INBOUND") slot.received += r.count;
    else if (r._id.failed) slot.failed += r.count;
    else slot.sent += r.count;
  }
  const active = subs.find((s) => s.status === "ACTIVE" && new Date(s.endDate) > new Date());

  return {
    user: { ...personOf(user), userType: user.userType, joinedAt: user.createdAt },
    wallet: round2(user.whatsappWallet),
    account: account ? { ...account, _id: undefined, userId: undefined, healthEvents: (account.healthEvents || []).slice(-8).reverse() } : null,
    subscription: active ? {
      id: String(active._id), plan: plans.get(String(active.planId))?.title || "Plan", cycle: active.cycle, startDate: active.startDate, endDate: active.endDate,
      credits: { MARKETING: active.marketingCredits, UTILITY: active.utilityCredits, AUTHENTICATION: active.authenticationCredits, SERVICE: active.serviceCredits },
    } : null,
    subscriptionHistory: subs.map((s) => ({ id: String(s._id), plan: plans.get(String(s.planId))?.title || "Plan", status: s.status, startDate: s.startDate, endDate: s.endDate, cycle: s.cycle })),
    chatbot: chatbotSub ? { status: chatbotSub.status, endDate: chatbotSub.endDate } : null,
    transactions: transactions.map((t) => ({ id: String(t._id), type: t.type, amount: t.amount, mode: t.mode, description: t.description, newBalance: t.newBalance, at: t.createdAt })),
    traffic30d: traffic,
    uniqueChats30d: conversations,
    byCategory: byCategory.map((r) => ({ category: r._id, messages: r.count, walletSpend: rupees(r.paise) })),
    perDay: [...series.values()],
    failures: failures.map((f) => ({ to: f.to, templateName: f.templateName || "", errorCode: f.errorCode || null, errorMessage: f.errorMessage || "", at: f.createdAt })),
    assets: {
      templates: counts(templates), campaigns: counts(campaigns), flows: counts(flows),
      contacts, groups, labels, links,
    },
    recentCampaigns: recentCampaigns.map((c) => ({ id: String(c._id), name: c.name, status: c.status, totalContacts: c.totalContacts, stats: c.stats || {}, at: c.scheduledAt || c.createdAt })),
    integrations: integrations.map((i) => ({
      id: String(i._id), app: i.app, label: i.label || "", paused: Boolean(i.config?.paused), needsReconnect: Boolean(i.config?.needsReconnect),
      stats: i.stats || {}, mappings: (i.mappings || []).length, activeMappings: (i.mappings || []).filter((m) => m.enabled !== false).length, connectedAt: i.createdAt,
    })),
    api: {
      keys: keys.map((k) => ({ id: String(k._id), name: k.name, hint: `${k.prefix}…${k.last4}`, service: k.service, access: k.access, lastUsedAt: k.lastUsedAt, callCount: k.callCount || 0, revokedAt: k.revokedAt, createdAt: k.createdAt })),
      calls30d: apiCalls30,
      webhook: hook ? { url: hook.url || "", enabled: Boolean(hook.enabled) } : null,
      package: apiPackage || null,
    },
    support: tickets.map((t) => ({ id: String(t._id), subject: t.subject, category: t.category, status: t.status, priority: t.priority, at: t.createdAt })),
    controls: { ...control, effective: effective.features, limitsEffective: await controls.limitsFor(id) },
    audit: audit.map(auditView),
  };
}

/* ------------------------------------------------------------------ Customer actions */
async function adjustWallet(admin, userId, body = {}) {
  const id = oid(userId);
  const amount = round2(body.amount);
  const reason = String(body.reason || "").trim().slice(0, 200);
  if (!Number.isFinite(amount) || amount === 0) throw fail(400, "Enter an amount other than zero");
  if (Math.abs(amount) > 1000000) throw fail(400, "That amount is too large");
  if (!reason) throw fail(400, "Write why the wallet is being changed");
  const filter = amount < 0 ? { _id: id, whatsappWallet: { $gte: -amount } } : { _id: id };
  const before = await User.findById(id).select("whatsappWallet").lean();
  if (!before) throw fail(404, "Customer not found");
  const after = await User.findOneAndUpdate(filter, { $inc: { whatsappWallet: amount } }, { new: true }).select("whatsappWallet").lean();
  if (!after) throw fail(409, `The wallet has only ₹${round2(before.whatsappWallet)}; it cannot go below zero`);
  const newBalance = round2(after.whatsappWallet);
  const previousBalance = round2(newBalance - amount);
  const txn = await Transaction.create({
    type: amount > 0 ? "CREDIT" : "DEBIT", amount: Math.abs(amount), userId: id, mode: "ADMIN",
    transactionId: `wa_admin_${Date.now()}`, description: `Admin: ${reason}`, previousBalance, newBalance,
  });
  await record(admin, amount > 0 ? "wallet.credit" : "wallet.debit", id, { amount, reason, previousBalance, newBalance, transactionId: String(txn._id) });
  return { wallet: newBalance };
}

async function adjustCredits(admin, userId, body = {}) {
  const id = oid(userId);
  const field = CREDIT_FIELDS[String(body.category || "").toUpperCase()];
  const amount = Number.parseInt(body.amount, 10);
  const reason = String(body.reason || "").trim().slice(0, 200);
  if (!field) throw fail(400, "Pick a message category");
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10000000) throw fail(400, "Enter a whole number of messages other than zero");
  if (!reason) throw fail(400, "Write why the credits are being changed");
  const filter = { userId: id, status: "ACTIVE", endDate: { $gt: new Date() } };
  if (amount < 0) filter[field] = { $gte: -amount };
  const sub = await Subscription.findOneAndUpdate(filter, { $inc: { [field]: amount } }, { new: true, sort: { endDate: -1 } }).lean();
  if (!sub) throw fail(409, amount < 0 ? "Not enough credits to take away, or no active plan" : "This customer has no active plan to add credits to");
  await record(admin, "credits.adjust", id, { category: String(body.category).toUpperCase(), amount, reason, balance: sub[field] });
  return { credits: sub[field] };
}

async function grantPlan(admin, userId, body = {}) {
  const id = oid(userId);
  const plan = await Plan.findById(oid(body.planId, "plan")).lean();
  if (!plan) throw fail(404, "Plan not found");
  const days = Number.parseInt(body.days, 10) || plan.duration || 30;
  if (days < 1 || days > 3660) throw fail(400, "Days must be between 1 and 3660");
  const reason = String(body.reason || "").trim().slice(0, 200);
  if (!reason) throw fail(400, "Write why this plan is being given");
  if (!(await User.exists({ _id: id }))) throw fail(404, "Customer not found");
  const user = await User.findById(id).select("whatsappWallet").lean();
  const txn = await Transaction.create({
    type: "CREDIT", amount: 0, userId: id, mode: "ADMIN", planId: plan._id, transactionId: `wa_admin_plan_${Date.now()}`,
    description: `Admin gave plan ${plan.title} for ${days} days: ${reason}`, previousBalance: round2(user.whatsappWallet), newBalance: round2(user.whatsappWallet),
  });
  await Subscription.updateMany({ userId: id, status: "ACTIVE" }, { $set: { status: "EXPIRED" } });
  const sub = await Subscription.create({
    userId: id, planId: plan._id, status: "ACTIVE", startDate: new Date(), endDate: new Date(Date.now() + days * DAY), transactionId: txn._id, cycle: "MONTHLY",
    marketingCredits: plan.marketingCredits || 0, utilityCredits: plan.utilityCredits || 0, authenticationCredits: plan.authenticationCredits || 0, serviceCredits: plan.serviceCredits || 0,
  });
  await record(admin, "plan.grant", id, { planId: String(plan._id), plan: plan.title, days, reason });
  return { subscriptionId: String(sub._id), endDate: sub.endDate };
}

async function extendPlan(admin, userId, body = {}) {
  const id = oid(userId);
  const days = Number.parseInt(body.days, 10);
  if (!Number.isInteger(days) || days === 0 || Math.abs(days) > 3660) throw fail(400, "Days must be a whole number between -3660 and 3660, not zero");
  const sub = await Subscription.findOne({ userId: id, status: "ACTIVE", endDate: { $gt: new Date() } }).sort({ endDate: -1 });
  if (!sub) throw fail(409, "This customer has no active plan");
  const before = sub.endDate;
  sub.endDate = new Date(sub.endDate.getTime() + days * DAY);
  if (sub.endDate <= new Date()) sub.status = "EXPIRED";
  await sub.save();
  await record(admin, "plan.extend", id, { days, from: before, to: sub.endDate, reason: String(body.reason || "").slice(0, 200) });
  return { endDate: sub.endDate, status: sub.status };
}

async function cancelPlan(admin, userId, body = {}) {
  const id = oid(userId);
  const result = await Subscription.updateMany({ userId: id, status: "ACTIVE" }, { $set: { status: "CANCELLED", endDate: new Date() } });
  if (!result.modifiedCount) throw fail(409, "This customer has no active plan");
  await record(admin, "plan.cancel", id, { reason: String(body.reason || "").slice(0, 200) });
  return { cancelled: result.modifiedCount };
}

async function setControls(admin, userId, body = {}) {
  const id = oid(userId);
  if (!(await User.exists({ _id: id }))) throw fail(404, "Customer not found");
  if (body.suspended === true && !String(body.suspendReason || "").trim()) throw fail(400, "Write the reason the customer will see");
  if (body.numberBlocked === true && !String(body.numberBlockReason || "").trim()) throw fail(400, "Write why the number is being blocked");
  const { before, after } = await controls.updateControl(id, body, admin?._id);
  const changes = {};
  if (before.suspended !== after.suspended) changes.suspended = after.suspended;
  if (after.suspended && before.suspendReason !== after.suspendReason) changes.suspendReason = after.suspendReason;
  const keys = new Set([...Object.keys(before.features), ...Object.keys(after.features)]);
  const features = {};
  for (const k of keys) if (before.features[k] !== after.features[k]) features[k] = after.features[k] ?? "default";
  if (Object.keys(features).length) changes.features = features;
  if (before.note !== after.note) changes.note = true;
  if (Object.keys(changes).length) {
    const action = "suspended" in changes ? (after.suspended ? "account.suspend" : "account.unsuspend") : "controls.update";
    await record(admin, action, id, changes);
  }
  if (before.numberBlocked !== after.numberBlocked) {
    await record(admin, after.numberBlocked ? "number.block" : "number.unblock", id, { reason: after.numberBlockReason });
  }
  const limitChanges = {};
  for (const k of Object.keys(controls.LIMITS)) if (before.limits[k] !== after.limits[k]) limitChanges[k] = { from: before.limits[k], to: after.limits[k] };
  if (Object.keys(limitChanges).length) await record(admin, "limits.update", id, limitChanges);
  return { ...after, effective: (await controls.effective(id)).features, limitsEffective: await controls.limitsFor(id) };
}

async function revokeKey(admin, userId, keyId) {
  const id = oid(userId);
  const key = await Key.findOneAndUpdate({ _id: oid(keyId, "key"), userId: id, revokedAt: null }, { $set: { revokedAt: new Date() } }, { new: true }).lean();
  if (!key) throw fail(404, "No active key with that id for this customer");
  await record(admin, "apikey.revoke", id, { keyId: String(key._id), name: key.name });
  return { id: String(key._id), revokedAt: key.revokedAt };
}

async function saveApiPackage(admin, userId, body = {}) {
  const id = oid(userId);
  const saved = await contract.save(admin, String(id), body);
  await record(admin, "apipackage.save", id, { whatsapp: saved.whatsapp, chatbot: saved.chatbot, whatsappLimit: saved.whatsappLimit, chatbotLimit: saved.chatbotLimit, requestsPerMinute: saved.requestsPerMinute, expiresAt: saved.expiresAt });
  return saved;
}

/* ------------------------------------------------------------------ Monitoring */
async function messages(query = {}) {
  const p = page(query, 100);
  const filter = {};
  if (["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"].includes(query.status)) filter.status = query.status;
  if (["INBOUND", "OUTBOUND"].includes(query.direction)) filter.direction = query.direction;
  if (query.userId) {
    const account = await Account.findOne({ userId: oid(query.userId) }).select("phoneNumberId").lean();
    filter.phoneNumberId = account?.phoneNumberId || "__none__";
  }
  if (query.source) filter.source = String(query.source).slice(0, 40);
  const q = String(query.q || "").trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    filter.$or = [{ templateName: new RegExp(escapeRegex(q), "i") }, { errorMessage: new RegExp(escapeRegex(q), "i") }];
    if (digits.length >= 4) filter.$or.push({ to: new RegExp(escapeRegex(digits)) });
  }
  const range = {};
  if (query.from && !Number.isNaN(Date.parse(query.from))) range.$gte = new Date(query.from);
  if (query.to && !Number.isNaN(Date.parse(query.to))) range.$lte = new Date(new Date(query.to).getTime() + DAY - 1);
  if (Object.keys(range).length) filter.createdAt = range;
  const [docs, total] = await Promise.all([
    Message.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit)
      .select("phoneNumberId to contactName direction type textBody templateName source status errorCode errorMessage billCategory billSource billPaise createdAt sentAt deliveredAt readAt failedAt campaignId").lean(),
    Message.countDocuments(filter),
  ]);
  const byPn = await userIdsByPhoneNumberIds([...new Set(docs.map((d) => d.phoneNumberId))]);
  const owners = new Map((await User.find({ _id: { $in: [...byPn.values()].map((a) => a.userId) } }).select("name mobile email disable").lean()).map((u) => [String(u._id), u]));
  const rows = docs.map((d) => {
    const a = byPn.get(d.phoneNumberId);
    return {
      id: String(d._id), userId: a ? String(a.userId) : null, user: a ? personOf(owners.get(String(a.userId))) : null, from: a?.phoneNumber || null,
      to: d.to, contactName: d.contactName || "", direction: d.direction, type: d.type, text: String(d.textBody || "").slice(0, 160), templateName: d.templateName || "",
      source: d.source || "", status: d.status, errorCode: d.errorCode || null, errorMessage: d.errorMessage || "",
      category: d.billCategory || null, charge: d.billSource === "wallet" ? rupees(d.billPaise) : 0, billSource: d.billSource || null,
      at: d.createdAt, deliveredAt: d.deliveredAt, readAt: d.readAt, failedAt: d.failedAt, campaignId: d.campaignId ? String(d.campaignId) : null,
    };
  });
  const errors = query.withErrors === "1" ? await Message.aggregate([
    { $match: { status: "FAILED", createdAt: { $gte: new Date(Date.now() - 7 * DAY) } } },
    { $group: { _id: { code: "$errorCode", message: "$errorMessage" }, count: { $sum: 1 }, last: { $max: "$createdAt" } } },
    { $sort: { count: -1 } }, { $limit: 8 },
  ]) : [];
  return { ...paged(rows, total, p), topErrors: errors.map((e) => ({ code: e._id.code || null, message: e._id.message || "No reason recorded", count: e.count, last: e.last })) };
}

async function numbers(query = {}) {
  const p = page(query);
  const filter = {};
  if (["CONNECTED", "DISCONNECTED"].includes(query.status)) filter.status = query.status;
  if (["GREEN", "YELLOW", "RED"].includes(query.quality)) filter.qualityRating = query.quality;
  if (query.quality === "UNKNOWN") filter.qualityRating = { $in: [null, "", "UNKNOWN"] };
  if (query.state === "blocked") filter.userId = { $in: await Control.distinct("userId", { numberBlocked: true }) };
  if (query.state === "suspended") filter.userId = { $in: await Control.distinct("userId", { suspended: true }) };
  const q = String(query.q || "").trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const users = await User.distinct("_id", { $or: [{ name: rx }, { email: rx }] });
    filter.$or = [{ verifiedName: rx }, { businessName: rx }, { phoneNumber: new RegExp(escapeRegex(q.replace(/\D/g, "") || q)) }, { userId: { $in: users } }];
  }
  const [docs, total] = await Promise.all([
    Account.find(filter).sort({ updatedAt: -1 }).skip(p.skip).limit(p.limit).select(ACCOUNT_FIELDS).lean(),
    Account.countDocuments(filter),
  ]);
  const owners = new Map((await User.find({ _id: { $in: docs.map((d) => d.userId) } }).select("name mobile email disable whatsappWallet").lean()).map((u) => [String(u._id), u]));
  const since7 = new Date(Date.now() - 7 * DAY);
  const usage = await Message.aggregate([
    { $match: { phoneNumberId: { $in: docs.map((d) => d.phoneNumberId).filter(Boolean) }, direction: "OUTBOUND", createdAt: { $gte: since7 } } },
    { $group: { _id: "$phoneNumberId", sent: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } } } },
  ]);
  const usageMap = new Map(usage.map((u) => [u._id, u]));
  const pns = docs.map((d) => d.phoneNumberId).filter(Boolean);
  const [todayRows, tierRows, ctrlRows] = await Promise.all([
    Message.aggregate([{ $match: { phoneNumberId: { $in: pns }, direction: "OUTBOUND", createdAt: { $gte: sendGuard.dayStart() } } }, { $group: { _id: "$phoneNumberId", n: { $sum: 1 } } }]),
    Message.aggregate([{ $match: { phoneNumberId: { $in: pns }, direction: "OUTBOUND", type: "TEMPLATE", createdAt: { $gte: new Date(Date.now() - DAY) } } }, { $group: { _id: { pn: "$phoneNumberId", to: "$to" } } }, { $group: { _id: "$_id.pn", n: { $sum: 1 } } }]),
    Control.find({ userId: { $in: docs.map((d) => d.userId) } }).select("userId suspended numberBlocked limits").lean(),
  ]);
  const todayMap = new Map(todayRows.map((r) => [r._id, r.n]));
  const tierMap = new Map(tierRows.map((r) => [r._id, r.n]));
  const ctrlMap = new Map(ctrlRows.map((c) => [String(c.userId), c]));
  const limitsByUser = new Map(await Promise.all(docs.map(async (d) => [String(d.userId), await controls.limitsFor(d.userId)])));
  const rows = docs.map((d) => ({
    blocked: Boolean(ctrlMap.get(String(d.userId))?.numberBlocked), suspended: Boolean(ctrlMap.get(String(d.userId))?.suspended),
    sentToday: todayMap.get(d.phoneNumberId) || 0, dailyLimit: limitsByUser.get(String(d.userId)).dailyMessages.value,
    apiPerMinute: limitsByUser.get(String(d.userId)).apiPerMinute.value,
    tier: { limit: tierLimit(d.messagingLimit), used24h: tierMap.get(d.phoneNumberId) || 0 },
    userId: String(d.userId), user: personOf(owners.get(String(d.userId))), phoneNumber: d.phoneNumber, verifiedName: d.verifiedName, businessName: d.businessName,
    status: d.status, qualityRating: d.qualityRating || null, qualityEvent: d.qualityEvent || null, messagingLimit: d.messagingLimit || null,
    accountReviewStatus: d.accountReviewStatus || null, codeVerificationStatus: d.codeVerificationStatus || null, billingMode: d.billingMode, onboardingMode: d.onboardingMode,
    connectedVia: d.connectedVia || null, wabaId: d.wabaId || null, phoneNumberId: d.phoneNumberId || null, disconnectionReason: d.disconnectionReason || null,
    lastHealthEvent: (d.healthEvents || []).slice(-1)[0] || null,
    sent7d: usageMap.get(d.phoneNumberId)?.sent || 0, failed7d: usageMap.get(d.phoneNumberId)?.failed || 0, updatedAt: d.updatedAt, connectedAt: d.createdAt,
  }));
  return paged(rows, total, p);
}

// The message limits of one customer with how much of them is used (works with or without a number).
async function customerLimits(userId) {
  const id = oid(userId);
  const user = await User.findById(id).select("name mobile email disable").lean();
  if (!user) throw fail(404, "Customer not found");
  const [account, control, limits] = await Promise.all([
    Account.findOne({ userId: id }).select("phoneNumber phoneNumberId status messagingLimit").lean(),
    controls.getControl(id, { fresh: true }),
    controls.limitsFor(id),
  ]);
  const pn = account?.phoneNumberId;
  const [today, month] = pn ? await Promise.all([
    Message.countDocuments({ phoneNumberId: pn, direction: "OUTBOUND", createdAt: { $gte: sendGuard.dayStart() } }),
    Message.countDocuments({ phoneNumberId: pn, direction: "OUTBOUND", createdAt: { $gte: sendGuard.monthStart() } }),
  ]) : [0, 0];
  return {
    user: personOf(user),
    number: account ? { phoneNumber: account.phoneNumber, status: account.status, messagingLimit: account.messagingLimit || null } : null,
    own: control.limits, limits, specs: controls.LIMITS,
    usage: { today, month },
    blocked: control.numberBlocked, suspended: control.suspended,
  };
}

// Meta's messaging tiers: how many people a number may start chats with in 24 hours.
function tierLimit(tier) {
  const m = /^TIER_(\d+)(K)?$/i.exec(String(tier || ""));
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

async function numberDetail(userId) {
  const id = oid(userId);
  const [user, account] = await Promise.all([
    User.findById(id).select("name mobile email disable whatsappWallet createdAt").lean(),
    Account.findOne({ userId: id }).select(`${ACCOUNT_FIELDS} metaSnapshot tokenExpiresAt`).lean(),
  ]);
  if (!user) throw fail(404, "Customer not found");
  if (!account) throw fail(404, "This customer has no WhatsApp number");
  const pn = account.phoneNumberId || "__none__";
  const today = sendGuard.dayStart();
  const since14 = new Date(Date.now() - 13 * DAY);
  since14.setUTCHours(0, 0, 0, 0);
  const minute = Math.floor(Date.now() / 60000);
  const Window = require("../../models/developerRequestWindowModel");
  const [control, limits, sentToday, failedToday, uniq24h, perDay, templates, campaigns, failures, topErrors, apiWindow, callsToday, keys, pkg] = await Promise.all([
    controls.getControl(id, { fresh: true }),
    controls.limitsFor(id),
    Message.countDocuments({ phoneNumberId: pn, direction: "OUTBOUND", createdAt: { $gte: today } }),
    Message.countDocuments({ phoneNumberId: pn, direction: "OUTBOUND", status: "FAILED", createdAt: { $gte: today } }),
    Message.distinct("to", { phoneNumberId: pn, direction: "OUTBOUND", type: "TEMPLATE", createdAt: { $gte: new Date(Date.now() - DAY) } }).then((r) => r.length),
    Message.aggregate([
      { $match: { phoneNumberId: pn, createdAt: { $gte: since14 } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, direction: "$direction", status: "$status" }, count: { $sum: 1 } } },
    ]),
    Template.aggregate([{ $match: { createdBy: id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Campaign.find({ createdBy: id, status: { $in: ["RUNNING", "QUEUED", "SCHEDULED", "PAUSED"] } }).sort({ createdAt: -1 }).limit(8).select("name status totalContacts sendRatePerMinute stats scheduledAt createdAt").lean(),
    Message.find({ phoneNumberId: pn, status: "FAILED" }).sort({ createdAt: -1 }).limit(10).select("to templateName errorCode errorMessage source createdAt").lean(),
    Message.aggregate([
      { $match: { phoneNumberId: pn, status: "FAILED", createdAt: { $gte: new Date(Date.now() - 7 * DAY) } } },
      { $group: { _id: { code: "$errorCode", message: "$errorMessage" }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 },
    ]),
    Window.findById(`${id}:${minute}`).lean(),
    Call.countDocuments({ userId: id, createdAt: { $gte: today } }),
    Key.countDocuments({ userId: id, revokedAt: null }),
    contract.read(id),
  ]);
  const series = new Map(lastDays(14).map((d) => [d, { day: d, sent: 0, delivered: 0, read: 0, failed: 0, received: 0 }]));
  for (const r of perDay) {
    const slot = series.get(r._id.day);
    if (!slot) continue;
    if (r._id.direction === "INBOUND") slot.received += r.count;
    else if (r._id.status === "FAILED") slot.failed += r.count;
    else if (r._id.status === "READ") slot.read += r.count;
    else if (r._id.status === "DELIVERED") slot.delivered += r.count;
    else slot.sent += r.count;
  }
  const { metaSnapshot, ...acct } = account;
  return {
    userId: String(id),
    user: personOf(user),
    wallet: round2(user.whatsappWallet),
    account: { ...acct, _id: undefined, userId: undefined, healthEvents: (account.healthEvents || []).slice(-12).reverse() },
    meta: metaSnapshot || null,
    control: { suspended: control.suspended, suspendReason: control.suspendReason, numberBlocked: control.numberBlocked, numberBlockReason: control.numberBlockReason, numberBlockedAt: control.numberBlockedAt, limits: control.limits },
    limits,
    limitSpecs: controls.LIMITS,
    usage: {
      sentToday, failedToday, dailyLimit: limits.dailyMessages.value,
      sentThisMonth: await Message.countDocuments({ phoneNumberId: pn, direction: "OUTBOUND", createdAt: { $gte: sendGuard.monthStart() } }),
      monthlyLimit: limits.monthlyMessages.value,
      tier: { name: account.messagingLimit || null, limit: tierLimit(account.messagingLimit), used24h: uniq24h },
      api: { perMinuteLimit: limits.apiPerMinute.value, packagePerMinute: pkg?.requestsPerMinute ?? null, thisMinute: apiWindow?.requests || 0, callsToday, activeKeys: keys, package: pkg || null },
    },
    perDay: [...series.values()],
    templates: Object.fromEntries(templates.map((r) => [r._id || "UNKNOWN", r.count])),
    campaigns: campaigns.map((c) => ({ id: String(c._id), name: c.name, status: c.status, totalContacts: c.totalContacts, ratePerMinute: c.sendRatePerMinute, stats: c.stats || {}, at: c.scheduledAt || c.createdAt })),
    failures: failures.map((f) => ({ to: f.to, templateName: f.templateName || "", errorCode: f.errorCode || null, errorMessage: f.errorMessage || "", source: f.source || "", at: f.createdAt })),
    topErrors: topErrors.map((e) => ({ code: e._id.code || null, message: e._id.message || "No reason recorded", count: e.count })),
  };
}

// Overridable for tests: the Graph API reader.
const meta = { get: (url, options) => axios.get(url, options) };
const GRAPH = "https://graph.facebook.com/v22.0";
const PHONE_FIELDS = ["display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput,name_status,code_verification_status,platform_type,status,account_mode,is_official_business_account,health_status,last_onboarded_time", "display_phone_number,verified_name,quality_rating,messaging_limit_tier,throughput,name_status,code_verification_status,status"];
const WABA_FIELDS = ["name,currency,timezone_id,message_template_namespace,account_review_status,business_verification_status,health_status", "name,currency,timezone_id,account_review_status"];

async function graphRead(id, fieldSets, token) {
  let last;
  for (const fields of fieldSets) {
    try {
      const { data } = await meta.get(`${GRAPH}/${id}`, { params: { fields }, headers: { Authorization: `Bearer ${token}` }, timeout: 12000 });
      return data;
    } catch (error) {
      last = error;
      if (error?.response?.data?.error?.code !== 100) break; // only an unknown field is worth retrying with fewer
    }
  }
  const e = last?.response?.data?.error;
  throw fail(502, e?.message ? `Meta: ${e.message}` : "Could not reach Meta");
}

async function refreshFromMeta(admin, userId) {
  const id = oid(userId);
  const account = await Account.findOne({ userId: id });
  if (!account) throw fail(404, "This customer has no WhatsApp number");
  const token = account.accessToken;
  if (!token || !account.phoneNumberId) throw fail(409, "This number has no saved Meta access");
  const phone = await graphRead(account.phoneNumberId, PHONE_FIELDS, token);
  let waba = null;
  let wabaError = null;
  if (account.wabaId) {
    try { waba = await graphRead(account.wabaId, WABA_FIELDS, token); } catch (error) { wabaError = error.message; }
  }
  const snapshot = { fetchedAt: new Date(), phone, waba, wabaError };
  const set = { metaSnapshot: snapshot };
  if (phone.quality_rating) set.qualityRating = phone.quality_rating;
  if (phone.messaging_limit_tier) set.messagingLimit = phone.messaging_limit_tier;
  if (phone.verified_name) set.verifiedName = phone.verified_name;
  if (phone.code_verification_status) set.codeVerificationStatus = phone.code_verification_status;
  if (waba?.account_review_status) set.accountReviewStatus = waba.account_review_status;
  await Account.updateOne({ _id: account._id }, { $set: set });
  await record(admin, "number.refresh", id, { quality: phone.quality_rating || null, tier: phone.messaging_limit_tier || null });
  return snapshot;
}

async function integrations(query = {}) {
  const p = page(query);
  const filter = {};
  if (query.app) filter.app = String(query.app).slice(0, 30);
  if (query.state === "error") filter["stats.lastError"] = { $nin: ["", null] };
  if (query.state === "paused") filter["config.paused"] = true;
  if (query.state === "reconnect") filter["config.needsReconnect"] = true;
  const [docs, total, byApp] = await Promise.all([
    Integration.find(filter).sort({ updatedAt: -1 }).skip(p.skip).limit(p.limit).select("userId app label config.paused config.needsReconnect stats mappings.enabled createdAt updatedAt").lean(),
    Integration.countDocuments(filter),
    Integration.aggregate([{ $group: { _id: "$app", count: { $sum: 1 }, errors: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$stats.lastError", ""] } }, 0] }, 1, 0] } }, sent: { $sum: { $ifNull: ["$stats.sent", 0] } }, imported: { $sum: { $ifNull: ["$stats.imported", 0] } } } }, { $sort: { count: -1 } }]),
  ]);
  const owners = new Map((await User.find({ _id: { $in: docs.map((d) => d.userId) } }).select("name mobile email disable").lean()).map((u) => [String(u._id), u]));
  const rows = docs.map((d) => ({
    id: String(d._id), userId: String(d.userId), user: personOf(owners.get(String(d.userId))), app: d.app, label: d.label || "",
    paused: Boolean(d.config?.paused), needsReconnect: Boolean(d.config?.needsReconnect), stats: d.stats || {},
    mappings: (d.mappings || []).length, connectedAt: d.createdAt, updatedAt: d.updatedAt,
  }));
  return { ...paged(rows, total, p), byApp: byApp.map((a) => ({ app: a._id, count: a.count, errors: a.errors, sent: a.sent, imported: a.imported })) };
}

async function apiUsage(query = {}) {
  const p = page(query);
  const since14 = new Date(Date.now() - 13 * DAY);
  since14.setUTCHours(0, 0, 0, 0);
  const filter = query.state === "revoked" ? { revokedAt: { $ne: null } } : query.state === "all" ? {} : { revokedAt: null };
  const [docs, total, perDay, packages] = await Promise.all([
    Key.find(filter).sort({ lastUsedAt: -1, createdAt: -1 }).skip(p.skip).limit(p.limit).select("userId name prefix last4 service access lastUsedAt callCount revokedAt createdAt").lean(),
    Key.countDocuments(filter),
    Call.aggregate([{ $match: { createdAt: { $gte: since14 } } }, { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, failed: { $eq: ["$status", "FAILED"] } }, count: { $sum: 1 }, paise: { $sum: { $ifNull: ["$billPaise", 0] } } } }]),
    require("../../models/developerContractModel").countDocuments({ expiresAt: { $gt: new Date() } }),
  ]);
  const owners = new Map((await User.find({ _id: { $in: docs.map((d) => d.userId) } }).select("name mobile email disable").lean()).map((u) => [String(u._id), u]));
  const series = new Map(lastDays(14).map((d) => [d, { day: d, calls: 0, failed: 0, charged: 0 }]));
  for (const r of perDay) {
    const slot = series.get(r._id.day);
    if (!slot) continue;
    slot.calls += r.count;
    if (r._id.failed) slot.failed += r.count;
    slot.charged = round2(slot.charged + rupees(r.paise));
  }
  return {
    ...paged(docs.map((k) => ({ id: String(k._id), userId: String(k.userId), user: personOf(owners.get(String(k.userId))), name: k.name, hint: `${k.prefix}…${k.last4}`, service: k.service, access: k.access, lastUsedAt: k.lastUsedAt, callCount: k.callCount || 0, revokedAt: k.revokedAt, createdAt: k.createdAt })), total, p),
    perDay: [...series.values()],
    activePackages: packages,
  };
}

/* ------------------------------------------------------------------ Panel settings + audit */
async function panelSettings() {
  const global = await controls.getGlobal({ fresh: true });
  return { ...global, limitSpecs: controls.LIMITS, catalog: controls.FEATURES.map(({ key, label, group, paths, api, hint, blockReads }) => ({ key, label, group, paths, guarded: api.length > 0, blockReads: Boolean(blockReads), hint: hint || "" })), menuItems: controls.MENU };
}

async function savePanelSettings(admin, body = {}) {
  const { before, after } = await controls.updateGlobal(body, admin?._id);
  const changes = {};
  for (const [k, v] of Object.entries(after.features)) {
    const old = before.features[k];
    if (old.enabled !== v.enabled || old.message !== v.message) changes[k] = { enabled: v.enabled, message: v.message };
  }
  if (Object.keys(changes).length) await record(admin, "features.global", null, changes);
  if (JSON.stringify(before.announcement) !== JSON.stringify(after.announcement)) await record(admin, "announcement.update", null, { enabled: after.announcement.enabled, title: after.announcement.title });
  if (JSON.stringify(before.menu) !== JSON.stringify(after.menu)) await record(admin, "menu.update", null, after.menu);
  const lim = {};
  for (const k of Object.keys(controls.LIMITS)) if (before.limits[k] !== after.limits[k]) lim[k] = { from: before.limits[k], to: after.limits[k] };
  if (Object.keys(lim).length) await record(admin, "limits.global", null, lim);
  return panelSettings();
}

function auditView(a) {
  return { id: String(a._id), at: a.at, admin: a.adminName, adminId: a.adminId ? String(a.adminId) : null, action: a.action, userId: a.userId ? String(a.userId) : null, details: a.details || {} };
}

async function audit(query = {}) {
  const p = page(query);
  const filter = {};
  if (query.userId) filter.userId = oid(query.userId);
  if (query.action) filter.action = new RegExp(`^${escapeRegex(String(query.action))}`);
  const [docs, total] = await Promise.all([Audit.find(filter).sort({ at: -1 }).skip(p.skip).limit(p.limit).lean(), Audit.countDocuments(filter)]);
  const owners = new Map((await User.find({ _id: { $in: docs.map((d) => d.userId).filter(Boolean) } }).select("name mobile email disable").lean()).map((u) => [String(u._id), u]));
  return paged(docs.map((d) => ({ ...auditView(d), user: d.userId ? personOf(owners.get(String(d.userId))) : null })), total, p);
}

async function planOptions() {
  return (await Plan.find({ disable: { $ne: true } }).sort({ sortOrder: 1, price: 1 }).select("title price duration marketingCredits utilityCredits authenticationCredits serviceCredits").lean())
    .map((pl) => ({ id: String(pl._id), title: pl.title, price: pl.price, duration: pl.duration }));
}

module.exports = {
  overview, customers, customer, adjustWallet, adjustCredits, grantPlan, extendPlan, cancelPlan, setControls, revokeKey, saveApiPackage,
  messages, numbers, numberDetail, customerLimits, refreshFromMeta, meta, tierLimit, integrations, apiUsage, panelSettings, savePanelSettings, audit, planOptions,
};
