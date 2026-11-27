// Super-admin controls over the WhatsApp customer panel: which features are on for everyone,
// which are switched on or off for one customer, suspended accounts, the announcement banner and
// the side menu. The panel reads the result from GET /whatsapp/panel-config; the API enforces it
// through `guard` (panel routes) and `check` (the public /api/v1 API).
const mongoose = require("mongoose");
const Control = require("../models/whatsappControlModel");
const PanelConfig = require("../models/whatsappPanelConfigModel");
const User = require("../models/userModel");
const { decodeAuthToken } = require("../middlewares/authMidd");

// key → panel pages it covers, API prefixes it guards, and whether reads are blocked too.
// Features with no API prefix live in the panel only; switching them off hides them there.
const FEATURES = [
  { key: "inbox", label: "Inbox", group: "Messaging", paths: ["/chat"], api: ["/whatsapp/chat/conversations", "/whatsapp/chat/upload-media", "/whatsapp/conversations"] },
  { key: "quickSend", label: "Single Send", group: "Messaging", paths: ["/quick-send"], api: [] },
  { key: "templates", label: "Templates", group: "Messaging", paths: ["/templates"], api: ["/whatsapp/templates"] },
  { key: "campaigns", label: "Campaigns", group: "Messaging", paths: ["/campaigns"], api: ["/whatsapp/campaigns"], hint: "Single Send also uses campaigns" },
  { key: "contacts", label: "Contacts", group: "Audience", paths: ["/contacts"], api: ["/whatsapp/contacts", "/whatsapp/contact-groups", "/whatsapp/contact-fields"] },
  { key: "labels", label: "Labels", group: "Audience", paths: ["/label"], api: ["/whatsapp/labels"] },
  { key: "linkQr", label: "Link & QR", group: "Audience", paths: ["/link-qr"], api: ["/whatsapp/links"] },
  { key: "quickReplies", label: "Suggested Replies", group: "Automation", paths: ["/quick-replies"], api: [] },
  { key: "autoresponder", label: "Autoresponder", group: "Automation", paths: ["/autoresponder"], api: [] },
  { key: "chatbot", label: "Chatbot", group: "Automation", paths: ["/chatbot"], api: ["/whatsapp/chat/bot-config", "/whatsapp/chat/bot-settings", "/whatsapp/chat/bot-subscription", "/whatsapp/chat/bot-plans/purchase"] },
  { key: "flowBuilder", label: "Flow Builder", group: "Automation", paths: ["/flow-builder"], api: [] },
  { key: "drip", label: "Drip Campaigns", group: "Automation", paths: ["/drip-campaigns"], api: [] },
  { key: "reminders", label: "Reminders", group: "Automation", paths: ["/reminders"], api: [] },
  { key: "aiAgent", label: "AI Agent", group: "Automation", paths: ["/ai-agents"], api: [] },
  { key: "forms", label: "Forms (WhatsApp Flows)", group: "Automation", paths: ["/forms"], api: ["/whatsapp/flows"] },
  { key: "metaAds", label: "Meta Ads", group: "Growth", paths: ["/meta-ads"], api: [] },
  { key: "agents", label: "Agents", group: "Team", paths: ["/agents"], api: [] },
  { key: "api", label: "Developer API", group: "Developers", paths: ["/apidocs"], api: ["/whatsapp/developer/keys", "/whatsapp/developer/send"], blockReads: true, hint: "Also blocks the public /api/v1 API" },
  { key: "integrations", label: "Integrations", group: "Developers", paths: ["/integrations"], api: ["/whatsapp/integrations"] },
  { key: "payments", label: "WhatsApp Payments", group: "Commerce", paths: ["/whatsapp-payments"], api: [] },
  { key: "fileManager", label: "File Manager", group: "Other", paths: ["/file-manager"], api: [] },
  { key: "tutorial", label: "Tutorial", group: "Other", paths: ["/tutorial"], api: [] },
];
const FEATURE_KEYS = new Set(FEATURES.map((f) => f.key));

// Side-menu entries an admin may hide or rename (paths as the panel's menu uses them).
const MENU = [
  ["/home", "Home"], ["/whatsapp-setup", "WhatsApp"], ["/billing/subscription", "Billing"], ["/tutorial", "Tutorial"],
  ["/chat", "Inbox"], ["/history", "History"], ["/quick-send", "Single Send"], ["/templates", "Templates"],
  ["/contacts", "Contacts"], ["/campaigns", "Campaigns"], ["/label", "Labels"], ["/link-qr", "Link & QR"],
  ["/quick-replies", "Suggested Replies"], ["/autoresponder", "Autoresponder"], ["/chatbot", "Chatbot"],
  ["/flow-builder", "Flow Builder"], ["/drip-campaigns", "Drip Campaigns"], ["/reminders", "Reminders"],
  ["/ai-agents", "AI Agent"], ["/forms", "Forms"], ["/meta-ads", "Meta Ads"], ["/agents", "Agents"],
  ["/apidocs", "API Docs"], ["/integrations", "Integrations"], ["/whatsapp-payments", "WhatsApp Payments"],
  ["/settings", "Settings"], ["/file-manager", "File Manager"],
].map(([path, label]) => ({ path, label }));
const MENU_PATHS = new Set(MENU.map((m) => m.path));

// A suspended customer can still see why, pay, renew and ask for help.
const SUSPENDED_ALLOWED = [
  "/whatsapp/panel-config", "/whatsapp/wallet", "/whatsapp/subscription", "/whatsapp/plans", "/whatsapp/pricing",
  "/whatsapp/support", "/whatsapp/account-menu",
];
// Read-only while suspended: the panel still shows which number is connected.
const SUSPENDED_READ = ["/whatsapp/account", "/whatsapp/stats"];

// Callbacks from Meta, payment providers and stores carry no customer token and are never guarded.
const NEVER_GUARDED = ["/whatsapp/webhook", "/whatsapp/meta/callback", "/whatsapp/developer/payment-events", "/webhooks/"];

const CACHE_MS = 10 * 1000;
let globalCache = null;
const userCache = new Map();
const roleCache = new Map();

const DEFAULT_MESSAGE = "This feature is switched off for your account. Contact support to turn it on.";
const SUSPENDED_MESSAGE = "Your WhatsApp account is suspended. Contact support.";

function fail(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function plainMap(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  return { ...value };
}

function viewGlobal(doc) {
  const stored = plainMap(doc?.features);
  const features = {};
  for (const f of FEATURES) {
    const row = stored[f.key] || {};
    features[f.key] = { enabled: row.enabled !== false, message: String(row.message || "").trim() };
  }
  const a = doc?.announcement || {};
  return {
    features,
    announcement: {
      enabled: Boolean(a.enabled), tone: a.tone || "info", title: a.title || "", text: a.text || "",
      linkLabel: a.linkLabel || "", linkUrl: a.linkUrl || "", startsAt: a.startsAt || null, endsAt: a.endsAt || null,
    },
    menu: { hidden: (doc?.menu?.hidden || []).filter((p) => MENU_PATHS.has(p)), labels: plainMap(doc?.menu?.labels) },
    updatedAt: doc?.updatedAt || null,
  };
}

async function getGlobal({ fresh = false } = {}) {
  if (!fresh && globalCache && Date.now() - globalCache.at < CACHE_MS) return globalCache.value;
  const doc = await PanelConfig.findOne({ key: "global" }).lean();
  const value = viewGlobal(doc);
  globalCache = { at: Date.now(), value };
  return value;
}

function viewControl(doc) {
  return {
    suspended: Boolean(doc?.suspended),
    suspendReason: doc?.suspendReason || "",
    features: Object.fromEntries(Object.entries(plainMap(doc?.features)).filter(([k, v]) => FEATURE_KEYS.has(k) && typeof v === "boolean")),
    note: doc?.note || "",
    updatedAt: doc?.updatedAt || null,
  };
}

async function getControl(userId, { fresh = false } = {}) {
  const id = String(userId);
  const hit = userCache.get(id);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const doc = mongoose.isValidObjectId(id) ? await Control.findOne({ userId: id }).lean() : null;
  const value = viewControl(doc);
  userCache.set(id, { at: Date.now(), value });
  if (userCache.size > 5000) userCache.delete(userCache.keys().next().value);
  return value;
}

function invalidate(userId) {
  if (userId) userCache.delete(String(userId));
  else { globalCache = null; userCache.clear(); }
}

// What one customer gets: a per-customer switch wins over the global one.
async function effective(userId) {
  const [global, control] = await Promise.all([getGlobal(), getControl(userId)]);
  const features = {};
  for (const f of FEATURES) {
    const g = global.features[f.key];
    const own = control.features[f.key];
    const enabled = typeof own === "boolean" ? own : g.enabled;
    features[f.key] = {
      enabled,
      source: typeof own === "boolean" ? "customer" : "global",
      message: enabled ? "" : (g.message || DEFAULT_MESSAGE),
    };
  }
  return { suspended: control.suspended, suspendReason: control.suspendReason, features };
}

function announcementLive(a, now = new Date()) {
  if (!a?.enabled || !(a.title || a.text)) return null;
  if (a.startsAt && new Date(a.startsAt) > now) return null;
  if (a.endsAt && new Date(a.endsAt) < now) return null;
  return { tone: a.tone, title: a.title, text: a.text, linkLabel: a.linkLabel, linkUrl: a.linkUrl, endsAt: a.endsAt };
}

async function panelConfig(userId) {
  const [global, mine] = await Promise.all([getGlobal(), effective(userId)]);
  return {
    suspended: mine.suspended,
    suspendReason: mine.suspended ? (mine.suspendReason || SUSPENDED_MESSAGE) : "",
    features: Object.fromEntries(Object.entries(mine.features).map(([k, v]) => [k, { enabled: v.enabled, message: v.message }])),
    paths: Object.fromEntries(FEATURES.flatMap((f) => f.paths.map((p) => [p, f.key]))),
    announcement: announcementLive(global.announcement),
    menu: global.menu,
  };
}

function featureForPath(path) {
  for (const f of FEATURES) {
    if (f.api.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) return f;
  }
  return null;
}

async function isAdminUser(userId) {
  const id = String(userId);
  const hit = roleCache.get(id);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.value;
  const user = await User.findById(id).select("userType").lean();
  const value = user?.userType === "ADMIN";
  roleCache.set(id, { at: Date.now(), value });
  if (roleCache.size > 5000) roleCache.delete(roleCache.keys().next().value);
  return value;
}

// Throws 423 for a suspended customer and 403 when the feature is off for them.
async function check(userId, featureKey, { write = true } = {}) {
  const mine = await effective(userId);
  if (mine.suspended) throw fail(423, mine.suspendReason || SUSPENDED_MESSAGE, { code: "ACCOUNT_SUSPENDED" });
  if (!featureKey) return;
  const spec = FEATURES.find((f) => f.key === featureKey);
  const state = mine.features[featureKey];
  if (state && !state.enabled && (write || spec?.blockReads)) {
    throw fail(403, state.message, { code: "FEATURE_DISABLED", feature: featureKey });
  }
}

// Express middleware for the panel API, mounted on /api before the WhatsApp routes.
async function guard(req, res, next) {
  const path = req.path;
  if (!path.startsWith("/whatsapp/") || NEVER_GUARDED.some((p) => path.startsWith(p))) return next();
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return next();
  let userId;
  try { userId = decodeAuthToken(token)?.userId; } catch (_) { userId = null; }
  if (!userId) return next();
  try {
    if (await isAdminUser(userId)) return next();
    const mine = await effective(userId);
    const under = (list) => list.some((p) => path === p || path.startsWith(`${p}/`));
    if (mine.suspended && !under(SUSPENDED_ALLOWED) && !(req.method === "GET" && under(SUSPENDED_READ))) {
      return res.status(423).json({ success: false, code: "ACCOUNT_SUSPENDED", message: mine.suspendReason || SUSPENDED_MESSAGE });
    }
    const feature = featureForPath(path);
    if (feature) {
      const state = mine.features[feature.key];
      if (!state.enabled && (req.method !== "GET" || feature.blockReads)) {
        return res.status(403).json({ success: false, code: "FEATURE_DISABLED", feature: feature.key, message: state.message });
      }
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad");
    return url.toString();
  } catch (_) {
    throw fail(400, "Announcement link must be a full http(s) address");
  }
}

function cleanDate(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw fail(400, `${label} is not a valid date`);
  return d;
}

async function updateGlobal(input, adminId) {
  const current = await getGlobal({ fresh: true });
  const set = { updatedBy: adminId || null };
  if (input.features && typeof input.features === "object") {
    const features = {};
    for (const f of FEATURES) {
      const row = input.features[f.key] ?? current.features[f.key];
      features[f.key] = { enabled: row?.enabled !== false, message: cleanText(row?.message, 280) };
    }
    set.features = features;
  }
  if (input.announcement && typeof input.announcement === "object") {
    const a = input.announcement;
    const tone = ["info", "success", "warning", "danger"].includes(a.tone) ? a.tone : "info";
    const next = {
      enabled: Boolean(a.enabled), tone, title: cleanText(a.title, 120), text: cleanText(a.text, 500),
      linkLabel: cleanText(a.linkLabel, 40), linkUrl: cleanUrl(a.linkUrl),
      startsAt: cleanDate(a.startsAt, "Start time"), endsAt: cleanDate(a.endsAt, "End time"),
    };
    if (next.enabled && !next.title && !next.text) throw fail(400, "Write a title or a message for the announcement");
    if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) throw fail(400, "The announcement must end after it starts");
    set.announcement = next;
  }
  if (input.menu && typeof input.menu === "object") {
    const hidden = [...new Set((Array.isArray(input.menu.hidden) ? input.menu.hidden : []).filter((p) => MENU_PATHS.has(p)))];
    if (hidden.includes("/settings") || hidden.includes("/home")) throw fail(400, "Home and Settings cannot be hidden");
    const labels = {};
    for (const [path, label] of Object.entries(input.menu.labels || {})) {
      const text = cleanText(label, 40);
      if (MENU_PATHS.has(path) && text) labels[path] = text;
    }
    set.menu = { hidden, labels };
  }
  await PanelConfig.findOneAndUpdate({ key: "global" }, { $set: set, $setOnInsert: { key: "global" } }, { upsert: true, new: true, runValidators: true });
  invalidate();
  return { before: current, after: await getGlobal({ fresh: true }) };
}

async function updateControl(userId, input, adminId) {
  const before = await getControl(userId, { fresh: true });
  const set = { updatedBy: adminId || null };
  if (typeof input.suspended === "boolean") {
    set.suspended = input.suspended;
    set.suspendReason = input.suspended ? cleanText(input.suspendReason, 300) : "";
  }
  if (input.features && typeof input.features === "object") {
    const next = { ...before.features };
    for (const [key, value] of Object.entries(input.features)) {
      if (!FEATURE_KEYS.has(key)) throw fail(400, `Unknown feature: ${key}`);
      if (value === null || value === "default") delete next[key];
      else if (typeof value === "boolean") next[key] = value;
      else throw fail(400, `Feature ${key} must be on, off or default`);
    }
    set.features = next;
  }
  if (typeof input.note === "string") set.note = cleanText(input.note, 2000);
  await Control.findOneAndUpdate({ userId }, { $set: set, $setOnInsert: { userId } }, { upsert: true, new: true, runValidators: true });
  invalidate(userId);
  return { before, after: await getControl(userId, { fresh: true }) };
}

module.exports = {
  FEATURES, MENU, SUSPENDED_ALLOWED,
  getGlobal, getControl, effective, panelConfig, featureForPath, check, guard,
  updateGlobal, updateControl, invalidate, announcementLive,
};
