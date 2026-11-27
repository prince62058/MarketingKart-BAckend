// Super admin → WhatsApp customer notifications.
//
// Admin (WA_ADMIN):  POST /api/admin/whatsapp/notifications/preview   who would receive it
//                    POST /api/admin/whatsapp/notifications           send now
//                    GET  /api/admin/whatsapp/notifications           history with read counts
//                    POST /api/admin/whatsapp/notifications/:id/withdraw
// Customer:          GET  /api/whatsapp/notifications                 own inbox (+ unread count)
//                    GET  /api/whatsapp/notifications/unread-count
//                    POST /api/whatsapp/notifications/:id/read
//                    POST /api/whatsapp/notifications/read-all
//
// Every notice shows in the customer panel's bell. With the "app" channel it is also pushed to the
// MarketingKart mobile app and listed in the app's own notification screen.
const express = require("express");
const mongoose = require("mongoose");
const { authUser, isAdmin } = require("../../middlewares/authMidd");
const { requirePermission } = require("../../middlewares/adminPermission");
const asyncHandler = require("../../utils/asyncHandler");
const User = require("../../models/userModel");
const Account = require("../../models/whatsappAccountModel");
const Subscription = require("../../models/whatsappSubscriptionModel");
const Control = require("../../models/whatsappControlModel");
const AppNotification = require("../../models/notificationModel");
const service = require("./waAdmin.service");

const TONES = ["info", "success", "warning", "danger"];
const SEGMENTS = {
  connected: "Connected number",
  disconnected: "Disconnected number",
  "no-number": "No number connected",
  "low-quality": "Low or medium quality number",
  suspended: "Suspended customers",
  "active-plan": "Active plan",
  "no-plan": "No active plan",
  expiring: "Plan ends within 7 days",
};
const MAX_PICKED = 500;
const DAY = 24 * 60 * 60 * 1000;

const noticeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 1000 },
    tone: { type: String, enum: TONES, default: "info" },
    link: { label: { type: String, default: "", maxlength: 40 }, url: { type: String, default: "", maxlength: 500 } },
    audience: {
      type: { type: String, enum: ["all", "segment", "customers"], required: true },
      segment: { type: String, default: "" },
      picked: { type: Number, default: 0 },
    },
    channels: { panel: { type: Boolean, default: true }, app: { type: Boolean, default: false } },
    recipients: { type: Number, default: 0 },
    push: { sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 }, noDevice: { type: Number, default: 0 }, done: { type: Boolean, default: false } },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", default: null },
    createdByName: { type: String, default: "" },
    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true }
);
const Notice = mongoose.models.whatsappAdminNotice || mongoose.model("whatsappAdminNotice", noticeSchema);

const receiptSchema = new mongoose.Schema(
  {
    noticeId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappAdminNotice", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true },
    readAt: { type: Date, default: null },
    withdrawn: { type: Boolean, default: false },
  },
  { timestamps: true }
);
receiptSchema.index({ noticeId: 1, userId: 1 }, { unique: true });
receiptSchema.index({ userId: 1, withdrawn: 1, createdAt: -1 });
const Receipt = mongoose.models.whatsappAdminNoticeReceipt || mongoose.model("whatsappAdminNoticeReceipt", receiptSchema);

const fail = (status, message) => Object.assign(new Error(message), { status });
const oid = (v) => {
  if (!mongoose.isValidObjectId(v)) throw fail(400, "Invalid id");
  return new mongoose.Types.ObjectId(String(v));
};
const text = (v, max) => String(v ?? "").trim().slice(0, max);

/* ------------------------------------------------------------------ audience */
async function segmentIds(segment, all) {
  const inAll = { $in: all };
  const now = new Date();
  switch (segment) {
    case "connected":
    case "disconnected":
      return Account.distinct("userId", { userId: inAll, status: segment.toUpperCase() });
    case "no-number": {
      const withNumber = new Set((await Account.distinct("userId")).map(String));
      return all.filter((id) => !withNumber.has(String(id)));
    }
    case "low-quality":
      return Account.distinct("userId", { userId: inAll, qualityRating: { $in: ["RED", "YELLOW"] } });
    case "suspended":
      return Control.distinct("userId", { userId: inAll, suspended: true });
    case "active-plan":
      return Subscription.distinct("userId", { userId: inAll, status: "ACTIVE", endDate: { $gt: now } });
    case "no-plan": {
      const active = new Set((await Subscription.distinct("userId", { status: "ACTIVE", endDate: { $gt: now } })).map(String));
      return all.filter((id) => !active.has(String(id)));
    }
    case "expiring":
      return Subscription.distinct("userId", { userId: inAll, status: "ACTIVE", endDate: { $gt: now, $lte: new Date(now.getTime() + 7 * DAY) } });
    default:
      throw fail(400, "Choose who should get this notification.");
  }
}

/** Resolves an audience to active (not disabled) user ids. */
async function resolveAudience(input = {}) {
  const type = String(input.type || "");
  let ids;
  if (type === "all") ids = await service.customerIds();
  else if (type === "segment") {
    if (!SEGMENTS[input.segment]) throw fail(400, "Choose a valid customer group.");
    ids = await segmentIds(input.segment, await service.customerIds());
  } else if (type === "customers") {
    const picked = [...new Set((Array.isArray(input.userIds) ? input.userIds : []).map(String))];
    if (!picked.length) throw fail(400, "Pick at least one customer.");
    if (picked.length > MAX_PICKED) throw fail(400, `Pick up to ${MAX_PICKED} customers, or send to a group.`);
    ids = picked.map(oid);
  } else throw fail(400, "Choose who should get this notification.");
  const users = await User.find({ _id: { $in: ids }, disable: { $ne: true } }).select("_id name mobile email fcm").lean();
  return users;
}

async function preview(body) {
  const users = await resolveAudience(body?.audience);
  return {
    count: users.length,
    withApp: users.filter((u) => u.fcm).length,
    sample: users.slice(0, 5).map((u) => ({ id: String(u._id), name: u.name || null, mobile: u.mobile ?? null })),
  };
}

/* ------------------------------------------------------------------ send */
function cleanInput(body = {}) {
  const title = text(body.title, 120);
  const message = text(body.body ?? body.message, 1000);
  if (!title) throw fail(400, "Add a title.");
  if (!message) throw fail(400, "Write the message.");
  const tone = TONES.includes(body.tone) ? body.tone : "info";
  const linkUrl = text(body.link?.url, 500);
  const linkLabel = text(body.link?.label, 40);
  if (linkUrl && !/^https:\/\/[^\s]+$/i.test(linkUrl)) throw fail(400, "The link must start with https://");
  return { title, body: message, tone, link: { url: linkUrl, label: linkUrl ? linkLabel || "Open" : "" }, app: Boolean(body.channels?.app) };
}

let messaging = null;
function firebase() {
  if (messaging !== null) return messaging;
  try {
    const admin = require("firebase-admin");
    messaging = admin.apps.length ? admin.messaging() : false;
  } catch (_) {
    messaging = false;
  }
  return messaging;
}

const INVALID_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument", "messaging/mismatched-credential"]);

// Mobile app: a push plus a row in the app's own notification list. Runs after the response.
async function pushToApp(notice, users) {
  const counts = { sent: 0, failed: 0, noDevice: 0 };
  try {
    await AppNotification.insertMany(users.map((u) => ({
      title: notice.title, message: notice.body, userId: u._id, status: u.fcm ? "pending" : "sent",
      metadata: { type: "WhatsAppNotice", noticeId: String(notice._id), link: notice.link?.url || "" },
    })), { ordered: false });
    const fcm = firebase();
    const { buildFcmMessage } = require("../../helpers/fcmMessage");
    const withDevice = users.filter((u) => u.fcm);
    counts.noDevice = users.length - withDevice.length;
    for (let i = 0; i < withDevice.length; i += 50) {
      await Promise.all(withDevice.slice(i, i + 50).map(async (u) => {
        if (!fcm) { counts.failed += 1; return; }
        try {
          await fcm.send(buildFcmMessage({ token: u.fcm, title: notice.title, body: notice.body, data: { type: "WhatsAppNotice", noticeId: String(notice._id), link: notice.link?.url || "" } }));
          counts.sent += 1;
        } catch (error) {
          counts.failed += 1;
          if (INVALID_TOKEN.has(error?.errorInfo?.code)) await User.updateOne({ _id: u._id, fcm: u.fcm }, { $set: { fcm: null } }).catch(() => {});
        }
      }));
    }
  } catch (error) {
    console.error("[wa-notice] push failed", error.message);
  } finally {
    await Notice.updateOne({ _id: notice._id }, { $set: { push: { ...counts, done: true } } }).catch(() => {});
  }
}

async function send(admin, body = {}) {
  const input = cleanInput(body);
  const users = await resolveAudience(body.audience);
  if (!users.length) throw fail(400, "Nobody matches this audience yet.");
  const audience = { type: body.audience.type, segment: body.audience.type === "segment" ? body.audience.segment : "", picked: body.audience.type === "customers" ? users.length : 0 };
  const notice = await Notice.create({
    title: input.title, body: input.body, tone: input.tone, link: input.link, audience,
    channels: { panel: true, app: input.app }, recipients: users.length,
    push: { done: !input.app },
    createdBy: admin?._id || null, createdByName: admin?.name || admin?.email || "Admin",
  });
  await Receipt.insertMany(users.map((u) => ({ noticeId: notice._id, userId: u._id })), { ordered: false });
  await service.record(admin, "notification.send", users.length === 1 ? users[0]._id : null, {
    noticeId: String(notice._id), title: input.title, audience: audience.type === "segment" ? SEGMENTS[audience.segment] : audience.type === "all" ? "All customers" : `${users.length} picked`, recipients: users.length, app: input.app,
  });
  if (input.app) setImmediate(() => { pushToApp(notice, users); });
  return view(notice, 0);
}

function view(n, read) {
  return {
    id: String(n._id), title: n.title, body: n.body, tone: n.tone, link: n.link?.url ? { url: n.link.url, label: n.link.label } : null,
    audience: { ...n.audience, label: n.audience.type === "all" ? "All customers" : n.audience.type === "segment" ? SEGMENTS[n.audience.segment] || n.audience.segment : `${n.audience.picked} picked customer${n.audience.picked === 1 ? "" : "s"}` },
    channels: n.channels, recipients: n.recipients, read, push: n.push, sentBy: n.createdByName, sentAt: n.createdAt, withdrawnAt: n.withdrawnAt,
  };
}

async function history(query = {}) {
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const current = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const [docs, total] = await Promise.all([Notice.find({}).sort({ createdAt: -1 }).skip((current - 1) * limit).limit(limit).lean(), Notice.countDocuments({})]);
  const reads = await Receipt.aggregate([{ $match: { noticeId: { $in: docs.map((d) => d._id) }, readAt: { $ne: null } } }, { $group: { _id: "$noticeId", n: { $sum: 1 } } }]);
  const readMap = new Map(reads.map((r) => [String(r._id), r.n]));
  return { rows: docs.map((d) => view(d, readMap.get(String(d._id)) || 0)), total, currentPage: current, totalPages: Math.max(1, Math.ceil(total / limit)), segments: SEGMENTS };
}

async function withdraw(admin, id) {
  const notice = await Notice.findById(oid(id));
  if (!notice) throw fail(404, "Notification not found");
  if (!notice.withdrawnAt) {
    notice.withdrawnAt = new Date();
    await notice.save();
    await Receipt.updateMany({ noticeId: notice._id }, { $set: { withdrawn: true } });
    await service.record(admin, "notification.withdraw", null, { noticeId: String(notice._id), title: notice.title });
  }
  return view(notice.toObject(), 0);
}

/* ------------------------------------------------------------------ customer inbox */
async function inbox(userId, query = {}) {
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const current = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const filter = { userId, withdrawn: false };
  const [receipts, total, unread] = await Promise.all([
    Receipt.find(filter).sort({ createdAt: -1 }).skip((current - 1) * limit).limit(limit).lean(),
    Receipt.countDocuments(filter),
    Receipt.countDocuments({ ...filter, readAt: null }),
  ]);
  const notices = new Map((await Notice.find({ _id: { $in: receipts.map((r) => r.noticeId) } }).lean()).map((n) => [String(n._id), n]));
  const rows = receipts.filter((r) => notices.has(String(r.noticeId))).map((r) => {
    const n = notices.get(String(r.noticeId));
    return { id: String(n._id), title: n.title, body: n.body, tone: n.tone, link: n.link?.url ? { url: n.link.url, label: n.link.label } : null, at: r.createdAt, read: Boolean(r.readAt) };
  });
  return { rows, total, unread, currentPage: current, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

const unreadCount = async (userId) => ({ unread: await Receipt.countDocuments({ userId, withdrawn: false, readAt: null }) });

async function markRead(userId, id) {
  const r = await Receipt.findOneAndUpdate({ userId, noticeId: oid(id), withdrawn: false }, { $set: { readAt: new Date() } }, { new: true });
  if (!r) throw fail(404, "Notification not found");
  return unreadCount(userId);
}

async function markAllRead(userId) {
  await Receipt.updateMany({ userId, withdrawn: false, readAt: null }, { $set: { readAt: new Date() } });
  return { unread: 0 };
}

/* ------------------------------------------------------------------ routes */
const router = express.Router();
const admin = [asyncHandler(authUser), isAdmin, requirePermission("WA_ADMIN")];
const signedIn = asyncHandler(authUser);
const handle = (fn) => async (req, res) => {
  try {
    return res.json({ success: true, data: await fn(req) });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("[wa-notice]", req.method, req.originalUrl, error);
    return res.status(status).json({ success: false, message: status >= 500 ? "Something went wrong" : error.message });
  }
};
const who = (req) => req.authUser || req.user;
const base = "/admin/whatsapp/notifications";

router.post(`${base}/preview`, admin, handle((req) => preview(req.body)));
router.post(base, admin, handle((req) => send(who(req), req.body)));
router.get(base, admin, handle((req) => history(req.query)));
router.post(`${base}/:id/withdraw`, admin, handle((req) => withdraw(who(req), req.params.id)));

router.get("/whatsapp/notifications/unread-count", signedIn, handle((req) => unreadCount(req.user._id)));
router.post("/whatsapp/notifications/read-all", signedIn, handle((req) => markAllRead(req.user._id)));
router.get("/whatsapp/notifications", signedIn, handle((req) => inbox(req.user._id, req.query)));
router.post("/whatsapp/notifications/:id/read", signedIn, handle((req) => markRead(req.user._id, req.params.id)));

module.exports = { router, Notice, Receipt, resolveAudience, SEGMENTS };
