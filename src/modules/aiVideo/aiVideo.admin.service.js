// Everything an admin needs to run AI Video: usage numbers, every user's videos, avatars,
// credits and orders, and the few actions that change money or data. Each action is audited.
const mongoose = require("mongoose");
const Studio = require("./aiVideo.model");
const User = require("../../models/userModel");
const Business = require("../../models/businessModel");
const { normalizeMobileNumber } = require("../../utils/mobileValidetionHandler");
const heygen = require("./heygen.client");
const catalog = require("./heygen.catalog");
const avatars = require("./aiVideo.avatars");
const settings = require("./aiVideo.settings");
const logger = require("../../utils/logger");
const { httpError } = require("./aiVideo.errors");

const DAY_MS = 24 * 60 * 60 * 1000;
const ENTERPRISE_STATUSES = ["requested", "contacted", "approved", "rejected"];

const escapeRegex = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function objectId(id, label = "id") {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, `That ${label} is not valid.`);
  return new mongoose.Types.ObjectId(id);
}

function paging(query = {}) {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  return { limit, page, skip: (page - 1) * limit };
}

function pageResult({ data, total }, { page, limit }, extra = {}) {
  return { data, total, totalPages: Math.max(1, Math.ceil(total / limit)), currentPage: page, ...extra };
}

const userLookup = [
  { $lookup: { from: User.collection.name, localField: "userId", foreignField: "_id", as: "user" } },
  { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
];

const userView = { id: "$user._id", name: "$user.name", mobile: "$user.mobile", email: "$user.email" };

function searchStage(search, fields) {
  const text = String(search || "").trim();
  if (!text) return [];
  const regex = escapeRegex(text.slice(0, 80));
  return [
    {
      $match: {
        $or: fields.map(field => ({
          $expr: { $regexMatch: { input: { $toString: { $ifNull: [field, ""] } }, regex, options: "i" } },
        })),
      },
    },
  ];
}

const facet = ({ skip, limit }, project) => [
  { $facet: { data: [{ $skip: skip }, { $limit: limit }, { $project: project }], total: [{ $count: "n" }] } },
];

async function listEmbedded({ path, match, sort, search, searchFields, project, query }) {
  const p = paging(query);
  const pipeline = [
    { $unwind: `$${path}` },
    ...(match && Object.keys(match).length ? [{ $match: match }] : []),
    ...userLookup,
    ...searchStage(search, searchFields),
    { $sort: sort },
    ...facet(p, project),
  ];
  const [result] = await Studio.aggregate(pipeline);
  return { rows: result.data, total: (result.total[0] && result.total[0].n) || 0, p };
}

function dateRange(query, field) {
  const range = {};
  if (query.from && !Number.isNaN(new Date(query.from).getTime())) range.$gte = new Date(query.from);
  if (query.to && !Number.isNaN(new Date(query.to).getTime())) range.$lte = new Date(new Date(query.to).getTime() + DAY_MS - 1);
  return Object.keys(range).length ? { [field]: range } : {};
}

// ---------------------------------------------------------------------------
// Overview and health
// ---------------------------------------------------------------------------

async function health() {
  const service = require("./aiVideo.service");
  const provider = await service.providerStatus();
  const presenters = {};
  for (const name of ["priya", "raj"]) {
    try {
      const look = await catalog.resolvePresenter(name);
      presenters[name] = { ok: true, avatarId: look.avatarId };
    } catch (error) {
      presenters[name] = { ok: false, message: error.message };
    }
  }
  let payments = { configured: false, webhook: false };
  try {
    const razorpay = require("./aiVideo.payments");
    payments = { configured: razorpay.isConfigured(), webhook: razorpay.webhookConfigured() };
  } catch (error) {
    logger.warn(`[AI VIDEO ADMIN] payments module unavailable: ${error.message}`);
  }
  const storage = Boolean(process.env.DO_SPACES_KEY && process.env.DO_SPACES_SECRET && process.env.DO_SPACES_BUCKET && process.env.DO_SPACES_ENDPOINT);
  return {
    provider,
    presenters,
    config: { scriptWriter: Boolean(process.env.OPENAI_API_KEY), storage, payments },
  };
}

async function overview() {
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY_MS);
  const since24 = new Date(now - DAY_MS);
  const since30 = new Date(now - 30 * DAY_MS);

  const [studioTotals, voiceovers, byStatus, perDay, renderTimes, avatarGroups, orderGroups, enterpriseGroups, recentFailures, current] = await Promise.all([
    Studio.aggregate([{ $group: { _id: null, studios: { $sum: 1 }, credits: { $sum: "$credits" }, users: { $addToSet: "$userId" } } }]),
    Studio.aggregate([{ $project: { n: { $size: { $ifNull: ["$voiceovers", []] } } } }, { $group: { _id: null, total: { $sum: "$n" } } }]),
    Studio.aggregate([
      { $unwind: "$projects" },
      { $group: { _id: "$projects.status", count: { $sum: 1 }, seconds: { $sum: { $ifNull: ["$projects.durationSeconds", 0] } } } },
    ]),
    Studio.aggregate([
      { $unwind: "$projects" },
      { $match: { "projects.createdAt": { $gte: since7 } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$projects.createdAt" } }, status: "$projects.status" }, count: { $sum: 1 } } },
    ]),
    Studio.aggregate([
      { $unwind: "$projects" },
      { $match: { "projects.status": "Completed", "projects.completedAt": { $gte: since7 }, "projects.renderStartedAt": { $type: "date" } } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ["$projects.completedAt", "$projects.renderStartedAt"] } }, n: { $sum: 1 } } },
    ]),
    Studio.aggregate([
      { $unwind: "$avatars" },
      { $match: { "avatars.kind": { $ne: "studio" } } },
      { $group: { _id: { kind: "$avatars.kind", status: "$avatars.status" }, count: { $sum: 1 } } },
    ]),
    Studio.aggregate([
      { $unwind: "$orders" },
      { $group: { _id: "$orders.status", count: { $sum: 1 }, amount: { $sum: { $ifNull: ["$orders.price", 0] } } } },
    ]),
    Studio.aggregate([{ $match: { "enterprise.status": { $exists: true, $ne: null } } }, { $group: { _id: "$enterprise.status", count: { $sum: 1 } } }]),
    Studio.aggregate([
      { $unwind: "$projects" },
      { $match: { "projects.status": "Failed" } },
      { $sort: { "projects.createdAt": -1 } },
      { $limit: 5 },
      { $project: { _id: 0, studioId: "$_id", projectId: "$projects.id", title: "$projects.title", error: "$projects.error", createdAt: "$projects.createdAt" } },
    ]),
    Studio.aggregate([
      { $unwind: "$projects" },
      { $match: { "projects.createdAt": { $gte: since24 } } },
      { $count: "n" },
    ]),
  ]);

  const statusCount = Object.fromEntries(byStatus.map(row => [row._id || "Unknown", row.count]));
  const paid = orderGroups.find(row => row._id === "paid");
  const paid30 = await Studio.aggregate([
    { $unwind: "$orders" },
    { $match: { "orders.status": "paid", "orders.paidAt": { $gte: since30 } } },
    { $group: { _id: null, amount: { $sum: { $ifNull: ["$orders.price", 0] } }, count: { $sum: 1 } } },
  ]);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    const rows = perDay.filter(row => row._id.day === day);
    const count = status => (rows.find(row => row._id.status === status) || { count: 0 }).count;
    days.push({ day, created: rows.reduce((sum, row) => sum + row.count, 0), failed: count("Failed"), completed: count("Completed") });
  }

  return {
    studios: (studioTotals[0] && studioTotals[0].studios) || 0,
    users: (studioTotals[0] && studioTotals[0].users.length) || 0,
    creditsOutstanding: (studioTotals[0] && studioTotals[0].credits) || 0,
    videos: {
      total: byStatus.reduce((sum, row) => sum + row.count, 0),
      completed: statusCount.Completed || 0,
      rendering: statusCount.Rendering || 0,
      failed: statusCount.Failed || 0,
      draft: statusCount.Draft || 0,
      last24h: (current[0] && current[0].n) || 0,
      secondsRendered: (byStatus.find(row => row._id === "Completed") || { seconds: 0 }).seconds,
      averageRenderSeconds: renderTimes[0] ? Math.round(renderTimes[0].avgMs / 1000) : null,
      perDay: days,
    },
    voiceovers: (voiceovers[0] && voiceovers[0].total) || 0,
    avatars: avatarGroups.map(row => ({ kind: row._id.kind, status: row._id.status, count: row.count })),
    orders: {
      byStatus: orderGroups.map(row => ({ status: row._id, count: row.count, amount: row.amount })),
      revenueAllTime: paid ? paid.amount : 0,
      revenueLast30Days: (paid30[0] && paid30[0].amount) || 0,
      paidLast30Days: (paid30[0] && paid30[0].count) || 0,
    },
    enterprise: enterpriseGroups.map(row => ({ status: row._id, count: row.count })),
    recentFailures,
  };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function shapeVideo(row) {
  const project = row.project;
  const started = project.renderStartedAt ? new Date(project.renderStartedAt).getTime() : null;
  const finished = project.completedAt ? new Date(project.completedAt).getTime() : null;
  return {
    studioId: String(row.studioId),
    projectId: project.id,
    businessId: row.businessId || null,
    user: row.user && row.user.id ? { ...row.user, id: String(row.user.id) } : null,
    title: project.title,
    status: project.status,
    format: project.format,
    duration: project.duration,
    presenter: project.presenter,
    language: project.language,
    script: String(project.script || "").slice(0, 600),
    videoUrl: project.videoUrl || null,
    thumbnailUrl: project.thumbnailUrl || null,
    error: project.error || null,
    cost: project.cost ?? null,
    refunded: Boolean(project.refunded),
    providerVideoId: project.heygenVideoId || null,
    renderSeconds: started && finished ? Math.round((finished - started) / 1000) : null,
    createdAt: project.createdAt,
    completedAt: project.completedAt || null,
  };
}

async function listVideos(query = {}) {
  const status = ["Completed", "Rendering", "Draft", "Failed"].includes(query.status) ? query.status : null;
  const match = { ...(status ? { "projects.status": status } : {}), ...dateRange(query, "projects.createdAt") };
  if (query.studioId) match._id = objectId(query.studioId, "studio id");
  const { rows, total, p } = await listEmbedded({
    path: "projects",
    match,
    sort: { "projects.createdAt": -1 },
    search: query.search,
    searchFields: ["$projects.title", "$projects.script", "$projects.id", "$projects.heygenVideoId", "$user.name", "$user.email", "$user.mobile", "$businessId"],
    project: { _id: 0, studioId: "$_id", businessId: 1, user: userView, project: "$projects" },
    query,
  });
  return pageResult({ data: rows.map(shapeVideo), total }, p);
}

async function listAvatars(query = {}) {
  const status = ["Uploading", "Processing", "Consent needed", "Ready", "Failed"].includes(query.status) ? query.status : null;
  const kind = ["photo", "clone"].includes(query.kind) ? query.kind : null;
  const match = { "avatars.kind": kind || { $ne: "studio" }, ...(status ? { "avatars.status": status } : {}) };
  const { rows, total, p } = await listEmbedded({
    path: "avatars",
    match,
    sort: { "avatars.createdAt": -1 },
    search: query.search,
    searchFields: ["$avatars.name", "$avatars.id", "$user.name", "$user.email", "$user.mobile", "$businessId"],
    project: { _id: 0, studioId: "$_id", businessId: 1, user: userView, avatar: "$avatars" },
    query,
  });
  const data = rows.map(row => ({
    studioId: String(row.studioId),
    avatarId: row.avatar.id,
    businessId: row.businessId || null,
    user: row.user && row.user.id ? { ...row.user, id: String(row.user.id) } : null,
    name: row.avatar.name,
    kind: row.avatar.kind,
    status: row.avatar.status,
    consent: row.avatar.consentStatus || null,
    previewUrl: row.avatar.previewUrl || null,
    error: row.avatar.error || null,
    cost: row.avatar.cost ?? null,
    providerGroupId: row.avatar.heygenGroupId || null,
    createdAt: row.avatar.createdAt || null,
  }));
  return pageResult({ data, total }, p);
}

async function listStudios(query = {}) {
  const p = paging(query);
  const plan = query.plan ? { plan: String(query.plan) } : {};
  const pipeline = [
    ...(Object.keys(plan).length ? [{ $match: plan }] : []),
    ...userLookup,
    ...searchStage(query.search, ["$user.name", "$user.email", "$user.mobile", "$businessId", "$_id"]),
    { $sort: query.sort === "credits" ? { credits: -1 } : { updatedAt: -1 } },
    ...facet(p, {
      _id: 0,
      studioId: "$_id",
      businessId: 1,
      user: userView,
      credits: 1,
      plan: 1,
      planRenewsAt: 1,
      createdAt: 1,
      updatedAt: 1,
      counts: {
        videos: { $size: { $ifNull: ["$projects", []] } },
        // The two stock presenters are in every studio, so only avatars a customer made are counted.
        avatars: { $size: { $filter: { input: { $ifNull: ["$avatars", []] }, cond: { $ne: ["$$this.kind", "studio"] } } } },
        voiceovers: { $size: { $ifNull: ["$voiceovers", []] } },
        orders: { $size: { $ifNull: ["$orders", []] } },
      },
    }),
  ];
  const [result] = await Studio.aggregate(pipeline);
  const data = result.data.map(row => ({
    ...row,
    studioId: String(row.studioId),
    user: row.user && row.user.id ? { ...row.user, id: String(row.user.id) } : null,
  }));
  return pageResult({ data, total: (result.total[0] && result.total[0].n) || 0 }, p);
}

async function getStudio(studioId) {
  const studio = await Studio.findById(objectId(studioId, "studio id")).lean();
  if (!studio) throw httpError(404, "Studio not found");
  const user = await User.findById(studio.userId).select("name mobile email").lean();
  const latest = (list, n) => [...(list || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, n);
  return {
    studioId: String(studio._id),
    businessId: studio.businessId || null,
    user: user ? { id: String(user._id), name: user.name, mobile: user.mobile, email: user.email } : null,
    credits: studio.credits,
    plan: studio.plan,
    planRenewsAt: studio.planRenewsAt || null,
    goal: studio.goal || null,
    createdAt: studio.createdAt,
    videos: latest(studio.projects, 20).map(project => shapeVideo({ studioId: studio._id, businessId: studio.businessId, project })),
    avatars: (studio.avatars || []).filter(item => item.kind !== "studio").map(item => ({ id: item.id, name: item.name, kind: item.kind, status: item.status, consent: item.consentStatus || null })),
    orders: latest(studio.orders, 20).map(order => ({ id: order.id, kind: order.kind, itemId: order.itemId, billing: order.billing || null, price: order.price, credits: order.credits, status: order.status, method: order.method || null, razorpayPaymentId: order.razorpayPaymentId || null, createdAt: order.createdAt, paidAt: order.paidAt || null })),
    voiceovers: (studio.voiceovers || []).length,
    enterprise: studio.enterprise && studio.enterprise.status ? studio.enterprise : null,
  };
}

async function listOrders(query = {}) {
  const match = {};
  if (query.status) match["orders.status"] = String(query.status);
  if (query.method) match["orders.method"] = String(query.method);
  Object.assign(match, dateRange(query, "orders.createdAt"));
  const { rows, total, p } = await listEmbedded({
    path: "orders",
    match,
    sort: { "orders.createdAt": -1 },
    search: query.search,
    searchFields: ["$orders.id", "$orders.razorpayOrderId", "$orders.razorpayPaymentId", "$user.name", "$user.email", "$user.mobile", "$businessId"],
    project: { _id: 0, studioId: "$_id", businessId: 1, user: userView, order: "$orders" },
    query,
  });
  const data = rows.map(row => ({
    studioId: String(row.studioId),
    orderId: row.order.id,
    businessId: row.businessId || null,
    user: row.user && row.user.id ? { ...row.user, id: String(row.user.id) } : null,
    kind: row.order.kind,
    itemId: row.order.itemId,
    billing: row.order.billing || null,
    price: row.order.price,
    credits: row.order.credits,
    method: row.order.method || null,
    methodLabel: row.order.methodLabel || null,
    status: row.order.status,
    razorpayOrderId: row.order.razorpayOrderId || null,
    razorpayPaymentId: row.order.razorpayPaymentId || null,
    createdAt: row.order.createdAt,
    paidAt: row.order.paidAt || null,
  }));
  return pageResult({ data, total }, p);
}

async function listEnterprise(query = {}) {
  const status = ENTERPRISE_STATUSES.includes(query.status) ? query.status : null;
  const p = paging(query);
  const pipeline = [
    { $match: { "enterprise.status": status || { $exists: true, $ne: null } } },
    ...userLookup,
    ...searchStage(query.search, ["$enterprise.name", "$enterprise.phone", "$enterprise.company", "$user.name", "$user.mobile", "$user.email"]),
    { $sort: { updatedAt: -1 } },
    ...facet(p, { _id: 0, studioId: "$_id", businessId: 1, user: userView, enterprise: 1, updatedAt: 1 }),
  ];
  const [result] = await Studio.aggregate(pipeline);
  const data = result.data.map(row => ({
    studioId: String(row.studioId),
    businessId: row.businessId || null,
    user: row.user && row.user.id ? { ...row.user, id: String(row.user.id) } : null,
    name: row.enterprise.name,
    phone: row.enterprise.phone,
    company: row.enterprise.company || null,
    status: row.enterprise.status,
    note: row.enterprise.note || null,
    requestedAt: row.updatedAt,
  }));
  return pageResult({ data, total: (result.total[0] && result.total[0].n) || 0 }, p);
}

async function listAudit(query = {}) {
  const p = paging(query);
  const filter = {};
  if (query.action) filter.action = String(query.action);
  if (query.studioId) filter.studioId = String(query.studioId);
  const [data, total] = await Promise.all([
    settings.Audit.find(filter).sort({ at: -1 }).skip(p.skip).limit(p.limit).lean(),
    settings.Audit.countDocuments(filter),
  ]);
  return pageResult({ data: data.map(row => ({ ...row, id: String(row._id), _id: undefined })), total }, p);
}

// ---------------------------------------------------------------------------
// Actions (all audited)
// ---------------------------------------------------------------------------

async function adjustCredits({ admin, studioId, amount, reason }) {
  const delta = Number(amount);
  const note = String(reason || "").trim();
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) {
    throw httpError(400, "Enter a whole number of credits, up to 100000, positive to add or negative to remove.");
  }
  if (note.length < 3) throw httpError(400, "Add a short reason so the change can be traced later.");
  const id = objectId(studioId, "studio id");
  // A removal can never push a balance below zero.
  const updated = await Studio.findOneAndUpdate(delta < 0 ? { _id: id, credits: { $gte: -delta } } : { _id: id }, { $inc: { credits: delta } }, { new: true });
  if (!updated) {
    if (!(await Studio.exists({ _id: id }))) throw httpError(404, "Studio not found");
    throw httpError(400, "That is more credits than this studio has.");
  }
  await settings.recordAudit(admin, "credits.adjust", {
    studioId: id,
    userId: updated.userId,
    summary: `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} credits: ${note}`,
    data: { amount: delta, reason: note, before: updated.credits - delta, after: updated.credits },
  });
  return { studioId: String(id), credits: updated.credits };
}

// Finds (or opens) the studio a customer's app really uses, so credits land where they will be seen.
// A studio belongs to one business, so a customer with several businesses must be told apart.
async function studioForMobile({ mobile, businessId }) {
  const number = normalizeMobileNumber(mobile);
  if (!number) throw httpError(400, "Enter the customer's 10 digit mobile number.");
  const user = await User.findOne({ mobile: number }).select("_id name mobile").lean();
  if (!user) throw httpError(404, "No customer has this mobile number.");

  const [studios, businesses] = await Promise.all([
    Studio.find({ userId: user._id }).select("businessId").lean(),
    Business.find({ userId: user._id }).select("_id businessName").lean(),
  ]);
  const known = new Map(businesses.map(business => [String(business._id), business.businessName || "Business"]));
  for (const studio of studios) if (studio.businessId && !known.has(studio.businessId)) known.set(studio.businessId, "Business");

  let target = businessId ? String(businessId).trim() : null;
  if (target && !known.has(target)) throw httpError(400, "That business does not belong to this customer.");
  if (!target) {
    if (known.size > 1) {
      const list = [...known].map(([id, name]) => `${name} (${id})`).join(", ");
      throw httpError(409, `This customer has several businesses. Add the business id of the one to credit: ${list}`);
    }
    target = known.size === 1 ? [...known.keys()][0] : null;
  }
  // Opens the studio with the usual free credits if the customer has never used AI Video.
  const studio = await require("./aiVideo.service").getStudio(user._id, target);
  return { studio, user, businessName: target ? known.get(target) : null };
}

// The same audited credit change as adjustCredits, found by the customer's phone number.
async function adjustCreditsByMobile({ admin, mobile, businessId, amount, reason }) {
  const { studio, user, businessName } = await studioForMobile({ mobile, businessId });
  const result = await adjustCredits({ admin, studioId: studio._id, amount, reason });
  return { ...result, businessId: studio.businessId || null, businessName, user: { id: String(user._id), name: user.name || null, mobile: user.mobile } };
}

async function setPlan({ admin, studioId, planId, days }) {
  const id = objectId(studioId, "studio id");
  const config = await settings.get({ fresh: true });
  const plan = config.plans.find(item => item.id === planId);
  if (!plan) throw httpError(400, "Choose one of the plans on the Settings page.");
  const free = plan.id === "free";
  const term = Number(days);
  if (!free && (!Number.isInteger(term) || term < 1 || term > 3650)) throw httpError(400, "Enter how many days the plan lasts (1 to 3650).");
  const renewsAt = free ? null : new Date(Date.now() + term * DAY_MS);
  const updated = await Studio.findOneAndUpdate({ _id: id }, { $set: { plan: plan.id, planRenewsAt: renewsAt, planBilling: free ? null : "admin" } }, { new: true });
  if (!updated) throw httpError(404, "Studio not found");
  await settings.recordAudit(admin, "plan.set", {
    studioId: id,
    userId: updated.userId,
    summary: free ? "Moved to the free plan" : `Gave the ${plan.name} plan for ${term} days`,
    data: { plan: plan.id, days: free ? null : term, renewsAt },
  });
  return { studioId: String(id), plan: updated.plan, planRenewsAt: updated.planRenewsAt || null };
}

// For a finished video that turned out unusable. Failed renders are refunded automatically.
async function refundVideo({ admin, studioId, projectId, reason }) {
  const id = objectId(studioId, "studio id");
  const note = String(reason || "").trim();
  if (note.length < 3) throw httpError(400, "Add a short reason so the refund can be traced later.");
  const studio = await Studio.findOne({ _id: id, "projects.id": projectId }, { "projects.$": 1, userId: 1 }).lean();
  const project = studio && studio.projects && studio.projects[0];
  if (!project) throw httpError(404, "Video not found");
  if (project.status === "Rendering") throw httpError(400, "This video is still rendering.");
  const cost = Number(project.cost);
  if (!Number.isFinite(cost) || cost <= 0) throw httpError(400, "This video did not cost any credits.");
  const updated = await Studio.findOneAndUpdate(
    { _id: id, projects: { $elemMatch: { id: projectId, refunded: { $ne: true } } } },
    { $inc: { credits: cost }, $set: { "projects.$.refunded": true } },
    { new: true },
  );
  if (!updated) throw httpError(400, "This video was already refunded.");
  await settings.recordAudit(admin, "video.refund", {
    studioId: id,
    userId: studio.userId,
    summary: `Refunded ${cost} credits for "${project.title}": ${note}`,
    data: { projectId, cost, reason: note },
  });
  return { studioId: String(id), credits: updated.credits, refunded: cost };
}

async function deleteVideo({ admin, studioId, projectId }) {
  const id = objectId(studioId, "studio id");
  const studio = await Studio.findOne({ _id: id, "projects.id": projectId }, { "projects.$": 1, userId: 1 }).lean();
  const project = studio && studio.projects && studio.projects[0];
  if (!project) throw httpError(404, "Video not found");
  if (project.status === "Rendering") throw httpError(400, "This video is still rendering. Wait for it to finish or fail.");
  await Studio.updateOne({ _id: id }, { $pull: { projects: { id: projectId } } });
  // Best effort: the files and the provider copy are cleanup, not part of the user-visible result.
  if (project.heygenVideoId && heygen.isConfigured()) {
    heygen.deleteVideo(project.heygenVideoId).catch(error => logger.warn(`[AI VIDEO ADMIN] provider delete failed: ${error.message}`));
  }
  try {
    const { deleteByUrl } = require("../../utils/spacesClient");
    for (const url of [project.videoUrl, project.thumbnailUrl]) if (url) await deleteByUrl(url);
  } catch (error) {
    logger.warn(`[AI VIDEO ADMIN] storage cleanup failed: ${error.message}`);
  }
  await settings.recordAudit(admin, "video.delete", {
    studioId: id,
    userId: studio.userId,
    summary: `Deleted "${project.title}"`,
    data: { projectId, status: project.status },
  });
  return { deleted: true };
}

async function deleteAvatar({ admin, studioId, avatarId }) {
  const id = objectId(studioId, "studio id");
  const studio = await Studio.findById(id);
  if (!studio) throw httpError(404, "Studio not found");
  const avatar = studio.avatars.find(item => item.id === avatarId);
  const name = avatar && avatar.name;
  const result = await avatars.removeAvatar({ studio, avatarId });
  await settings.recordAudit(admin, "avatar.delete", {
    studioId: id,
    userId: studio.userId,
    summary: `Removed avatar "${name}"`,
    data: { avatarId },
  });
  return result;
}

async function updateEnterprise({ admin, studioId, status, note }) {
  const id = objectId(studioId, "studio id");
  if (!ENTERPRISE_STATUSES.includes(status)) throw httpError(400, `Status must be one of ${ENTERPRISE_STATUSES.join(", ")}.`);
  const text = String(note || "").trim().slice(0, 500);
  const updated = await Studio.findOneAndUpdate(
    { _id: id, "enterprise.status": { $exists: true, $ne: null } },
    { $set: { "enterprise.status": status, "enterprise.note": text, "enterprise.updatedAt": new Date() } },
    { new: true },
  );
  if (!updated) throw httpError(404, "Enterprise request not found");
  await settings.recordAudit(admin, "enterprise.update", { studioId: id, userId: updated.userId, summary: `Marked the enterprise request ${status}`, data: { status, note: text } });
  return { studioId: String(id), status };
}

module.exports = {
  ENTERPRISE_STATUSES,
  health,
  overview,
  listVideos,
  listAvatars,
  listStudios,
  getStudio,
  listOrders,
  listEnterprise,
  listAudit,
  adjustCredits,
  adjustCreditsByMobile,
  setPlan,
  refundVideo,
  deleteVideo,
  deleteAvatar,
  updateEnterprise,
  getSettings: () => settings.get({ fresh: true }),
  updateSettings: (input, admin) => settings.update(input, admin),
};
