const contract = require("./developerContract");
const crypto = require("crypto");
const axios = require("axios");
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Key = require("../models/whatsappApiKeyModel");
const Call = require("../models/whatsappApiCallModel");
const Hook = require("../models/whatsappDeveloperWebhookModel");
const Account = require("../models/whatsappAccountModel");
const Template = require("../models/whatsappTemplateModel");
const Message = require("../models/whatsappMessageModel");
const billing = require("./whatsappBillingService");
const cloud = require("./whatsappCloudApiService");

const ACTIVE_KEY_LIMIT = 5;
const DAY_WINDOW = 14;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isAdmin(user) {
  return user?.userType === "ADMIN" || user?.role === "ADMIN";
}

function hashKey(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function generateKey() {
  const raw = `mk_live_${crypto.randomBytes(24).toString("hex")}`;
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, 16), last4: raw.slice(-4) };
}

function normalizeTo(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

function signBody(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function assertPublicHttps(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw fail(400, "Webhook URL is not a valid address");
  }
  if (parsed.protocol !== "https:") throw fail(400, "Webhook URL must start with https://");
  if (parsed.username || parsed.password) throw fail(400, "Webhook URL cannot include a username or password");
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(host)
  ) {
    throw fail(400, "Webhook URL must be a public https address");
  }
  return parsed.toString();
}

function kolkataDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDate(iso, delta) {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + delta);
  return next.toISOString().slice(0, 10);
}

function fillDays(rows, days = DAY_WINDOW) {
  const map = new Map((rows || []).map((row) => [row._id, row]));
  const today = kolkataDate();
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = shiftDate(today, -i);
    const row = map.get(date) || {};
    out.push({
      date,
      calls: row.calls || 0,
      delivered: row.delivered || 0,
      failed: row.failed || 0,
      spentPaise: row.spentPaise || 0,
    });
  }
  return out;
}

function publicKey(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    prefix: doc.prefix,
    last4: doc.last4,
    service: doc.service || "whatsapp",
    access: doc.access ?? "send",
    hint: `${doc.prefix}…${doc.last4}`,
    lastUsedAt: doc.lastUsedAt,
    callCount: doc.callCount || 0,
    revokedAt: doc.revokedAt,
    createdAt: doc.createdAt,
  };
}

function publicCall(doc) {
  return {
    id: String(doc._id),
    to: doc.to,
    kind: doc.kind,
    templateName: doc.templateName || "",
    category: doc.category || "",
    status: doc.status,
    billSource: doc.billSource,
    billPaise: doc.billPaise || 0,
    metaMessageId: doc.metaMessageId,
    errorMessage: doc.errorMessage || "",
    createdAt: doc.createdAt,
  };
}

function targetUserId(actor, requested) {
  if (!requested || String(requested) === String(actor._id)) return actor._id;
  if (!isAdmin(actor)) throw fail(403, "You can only open your own line");
  if (!mongoose.Types.ObjectId.isValid(requested)) throw fail(400, "Unknown account");
  return requested;
}

async function createKey(actor, name, requestedUserId, access = "send", service = "whatsapp") {
  if (!["whatsapp","chatbot","both"].includes(service)) throw fail(400,"Unknown key service");
  if (!["send", "read"].includes(access)) throw fail(400, "Unknown key access");
  const userId = targetUserId(actor, requestedUserId);
  const owner = await User.findById(userId).select("_id disable");
  if (!owner) throw fail(404, "Unknown account");
  if (owner.disable) throw fail(403, "This account is disabled");
  const label = String(name || "").trim().slice(0, 40);
  if (!label) throw fail(400, "Name the project this key is for");
  const active = await Key.countDocuments({ userId, revokedAt: null });
  if (active >= ACTIVE_KEY_LIMIT) {
    throw fail(409, "This account already has 5 active keys. Revoke one to create another.");
  }
  const minted = generateKey();
  const doc = await Key.create({
    userId,
    name: label,
    service,
    access,
    prefix: minted.prefix,
    last4: minted.last4,
    hash: minted.hash,
  });
  return { ...publicKey(doc), secret: minted.raw };
}

async function listKeys(actor, requestedUserId) {
  const userId = targetUserId(actor, requestedUserId);
  const docs = await Key.find({ userId }).sort({ createdAt: -1 }).lean();
  return docs.map(publicKey);
}

async function revokeKey(actor, keyId) {
  if (!mongoose.Types.ObjectId.isValid(keyId)) throw fail(404, "Key not found");
  const doc = await Key.findById(keyId);
  if (!doc) throw fail(404, "Key not found");
  if (String(doc.userId) !== String(actor._id) && !isAdmin(actor)) {
    throw fail(403, "You can only revoke your own key");
  }
  if (!doc.revokedAt) {
    doc.revokedAt = new Date();
    await doc.save();
  }
  return publicKey(doc);
}

// Swaps the secret of an active key. The old secret stops working at once; the name,
// permissions and call history stay with the key.
async function regenerateKey(actor, keyId) {
  if (!mongoose.Types.ObjectId.isValid(keyId)) throw fail(404, "Key not found");
  const doc = await Key.findById(keyId).lean();
  if (!doc) throw fail(404, "Key not found");
  if (String(doc.userId) !== String(actor._id) && !isAdmin(actor)) {
    throw fail(403, "You can only regenerate your own key");
  }
  if (doc.revokedAt) throw fail(409, "A revoked key cannot be regenerated. Create a new key instead.");
  const minted = generateKey();
  const updated = await Key.findOneAndUpdate(
    { _id: doc._id, revokedAt: null },
    { $set: { prefix: minted.prefix, last4: minted.last4, hash: minted.hash, lastUsedAt: null } },
    { new: true }
  );
  if (!updated) throw fail(409, "A revoked key cannot be regenerated. Create a new key instead.");
  return { ...publicKey(updated), secret: minted.raw };
}

async function authenticate(raw) {
  const token = String(raw || "").trim();
  if (!token.startsWith("mk_live_")) return null;
  const doc = await Key.findOne({ hash: hashKey(token), revokedAt: null });
  if (!doc) return null;
  const user = await User.findById(doc.userId);
  if (!user || user.disable) return { disabled: true };
  return { key: doc, user };
}

async function seriesFor(userId, days = DAY_WINDOW) {
  const startIso = shiftDate(kolkataDate(), -(days - 1));
  const match = {};
  if (userId) match.userId = new mongoose.Types.ObjectId(String(userId));
  const rows = await Call.aggregate([
    { $match: match },
    {
      $addFields: {
        day: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" },
        },
      },
    },
    { $match: { day: { $gte: startIso } } },
    {
      $group: {
        _id: "$day",
        calls: { $sum: 1 },
        delivered: {
          $sum: { $cond: [{ $in: ["$status", ["DELIVERED", "READ"]] }, 1, 0] },
        },
        failed: {
          $sum: { $cond: [{ $in: ["$status", ["FAILED", "REJECTED"]] }, 1, 0] },
        },
        spentPaise: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$billSource", "wallet"] },
                  { $not: { $in: ["$status", ["FAILED", "REJECTED"]] } },
                ],
              },
              "$billPaise",
              0,
            ],
          },
        },
      },
    },
  ]);
  return fillDays(rows, days);
}

function totals(series, fromDate) {
  return series.reduce(
    (sum, day) => {
      if (fromDate && day.date < fromDate) return sum;
      sum.calls += day.calls;
      sum.delivered += day.delivered;
      sum.failed += day.failed;
      sum.spentPaise += day.spentPaise;
      return sum;
    },
    { calls: 0, delivered: 0, failed: 0, spentPaise: 0 }
  );
}

async function desk(actor, requestedUserId) {
  const userId = targetUserId(actor, requestedUserId);
  const user = String(userId) === String(actor._id) ? actor : await User.findById(userId).lean();
  if (!user) throw fail(404, "Account not found");
  const [account, apiPackage, keys, series, recent, config, webhook, approvedTemplates] = await Promise.all([
    Account.findOne({ userId }).lean(),
    contract.read(userId),
    Key.find({ userId }).sort({ createdAt: -1 }).lean(),
    seriesFor(userId),
    Call.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
    require("../models/developerContractModel").findOne({ userId }).select("botProfile.faqs.question").lean(),
    Hook.findOne({ userId }).select("enabled").lean(),
    Template.countDocuments({ createdBy: userId, disable: false, status: "APPROVED" }),
  ]);
  const today = kolkataDate();
  const monthStart = `${today.slice(0, 8)}01`;
  return {
    account: {
      name: user.name || "",
      mobile: user.mobile || "",
      email: user.email || "",
      disable: Boolean(user.disable),
      walletRupees: Number(user.whatsappWallet || 0),
    },
    number: account
      ? {
          phoneNumber: account.phoneNumber,
          status: account.status,
          verifiedName: account.verifiedName,
          accountReviewStatus: account.accountReviewStatus,
          codeVerificationStatus: account.codeVerificationStatus,
          qualityRating: account.qualityRating,
          messagingLimit: account.messagingLimit,
          businessName: account.businessName,
          billingMode: account.billingMode || "PLATFORM",
        }
      : { phoneNumber: null, status: "DISCONNECTED", verifiedName: null, qualityRating: null, messagingLimit: null, businessName: null, billingMode: "PLATFORM" },
    apiPackage,
    automation: {
      botEnabled: Boolean(apiPackage?.chatbot && apiPackage.expiresAt > new Date()),
      faqRules: config?.botProfile?.faqs?.length || 0,
      webhookEnabled: Boolean(webhook?.enabled),
      approvedTemplates,
    },
    keys: keys.map(publicKey),
    today: totals(series, today),
    month: totals(series, monthStart),
    series,
    recent: recent.map(publicCall),
  };
}

async function listCalls(actor, requestedUserId, page = 1) {
  const userId = targetUserId(actor, requestedUserId);
  const limit = 20;
  const skip = (Math.max(1, Number(page) || 1) - 1) * limit;
  const [data, total] = await Promise.all([
    Call.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Call.countDocuments({ userId }),
  ]);
  return {
    data: data.map(publicCall),
    total,
    page: Math.max(1, Number(page) || 1),
    totalPages: Math.ceil(total / limit) || 1,
  };
}

async function messageDetail(user, id) {
  if (!mongoose.isObjectIdOrHexString(id)) throw fail(404, "Message not found");
  const row = await Call.findOne({ userId: user._id, $or: [{ _id: id }, { messageId: id }] }).lean();
  if (!row) throw fail(404, "Message not found");
  return publicCall(row);
}

async function directory() {
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const [keys, calls] = await Promise.all([
    Key.aggregate([
      { $match: { revokedAt: null } },
      { $group: { _id: "$userId", keys: { $sum: 1 } } },
    ]),
    Call.aggregate([
      { $match: { createdAt: { $gte: start } } },
      {
        $group: {
          _id: "$userId",
          calls: { $sum: 1 },
          spentPaise: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$billSource", "wallet"] },
                    { $not: { $in: ["$status", ["FAILED", "REJECTED"]] } },
                  ],
                },
                "$billPaise",
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);
  const byUser = new Map();
  keys.forEach((row) => byUser.set(String(row._id), { userId: String(row._id), keys: row.keys, calls: 0, spentPaise: 0 }));
  calls.forEach((row) => {
    const id = String(row._id);
    const current = byUser.get(id) || { userId: id, keys: 0, calls: 0, spentPaise: 0 };
    current.calls = row.calls;
    current.spentPaise = row.spentPaise;
    byUser.set(id, current);
  });
  return [...byUser.values()];
}

async function getWebhook(userId) {
  let hook = await Hook.findOne({ userId }).lean();
  if (!hook) {
    hook = await Hook.create({
      userId,
      secret: crypto.randomBytes(24).toString("hex"),
      enabled: false,
      url: "",
    });
    hook = hook.toObject();
  }
  return { url: hook.url || "", enabled: Boolean(hook.enabled && hook.url), secret: hook.secret };
}

async function saveWebhook(userId, body) {
  const enabled = Boolean(body.enabled);
  const url = enabled || body.url ? assertPublicHttps(body.url) : "";
  const hook = await Hook.findOneAndUpdate(
    { userId },
    { $set: { url, enabled: Boolean(enabled && url) }, $setOnInsert: { secret: crypto.randomBytes(24).toString("hex"), userId } },
    { new: true, upsert: true }
  ).lean();
  return { url: hook.url || "", enabled: hook.enabled, secret: hook.secret };
}

async function rotateWebhookSecret(userId) {
  const secret = crypto.randomBytes(24).toString("hex");
  const hook = await Hook.findOneAndUpdate(
    { userId },
    { $set: { secret }, $setOnInsert: { userId, url: "", enabled: false } },
    { new: true, upsert: true }
  ).lean();
  return { url: hook.url || "", enabled: hook.enabled, secret: hook.secret };
}

async function sendForProject({ user, key, body, idempotencyKey }) {
  const cleanKey = String(idempotencyKey || "").trim().slice(0, 80);
  if (cleanKey) {
    const existing = await Call.findOne({ keyId: key._id, idempotencyKey: cleanKey }).lean();
    if (existing?.metaMessageId) {
      return {
        id: existing.messageId ? String(existing.messageId) : String(existing._id),
        metaMessageId: existing.metaMessageId,
        to: existing.to,
        status: existing.status,
        category: existing.category,
        charge: { source: existing.billSource, rupees: Number(((existing.billPaise || 0) / 100).toFixed(2)) },
        replayed: true,
      };
    }
  }

  const to = normalizeTo(body?.to);
  if (!to) throw fail(400, "to must be a phone number, with country code or a 10-digit Indian mobile");

  const account = await Account.findOne({ userId: user._id, status: "CONNECTED" });
  if (!account?.phoneNumberId || !account?.accessToken) {
    throw fail(409, "Connect a WhatsApp number before sending");
  }

  const kind = body?.type;
  if (kind !== "text" && kind !== "template") throw fail(400, "type must be text or template");

  let category = "SERVICE";
  let templateName = "";
  let language = "en_US";
  let components = [];
  let textBody = "";

  if (kind === "text") {
    textBody = String(body.text || "").trim();
    if (!textBody) throw fail(400, "text is required");
    if (textBody.length > 4096) throw fail(400, "text is longer than 4,096 characters");
  } else {
    templateName = String(body.template?.name || "").trim().toLowerCase();
    language = String(body.template?.language || "en_US").trim() || "en_US";
    components = Array.isArray(body.template?.components) ? body.template.components.slice(0, 20) : [];
    if (!templateName) throw fail(400, "template.name is required");
    const template = await Template.findOne({ name: templateName, createdBy: user._id, disable: false });
    if (!template) throw fail(404, "That template is not on this account");
    if (template.status !== "APPROVED") throw fail(409, "That template is not approved yet");
    category = billing.categoryOf(template);
    textBody = template.bodyText || templateName;
  }

  const onPackage = await contract.hasActive(user._id, "whatsapp");
  let call;
  try {
    call = await Call.create({
      userId:user._id, keyId:key._id, idempotencyKey:cleanKey || undefined,
      to, kind, templateName, category, status:"PROCESSING", billSource:onPackage ? "api_package" : null,
    });
  } catch (error) {
    if (error.code === 11000 && cleanKey) throw fail(409,"This request has already been recorded. Check its status before retrying.");
    throw error;
  }
  // An API package pays when one is active. Otherwise a template is billed exactly like a
  // campaign message (plan credits first, then the WhatsApp wallet); a text reply can only
  // go inside the customer's 24-hour window, which is free, as it is in the inbox.
  let hold = null;
  const charge = { source: onPackage ? "api_package" : "none", paise: 0 };
  try {
    if (onPackage) {
      await contract.authorize(user._id, "whatsapp", true);
    } else if (kind === "template") {
      hold = await billing.reserveCampaign({ userId: user._id, category, count: 1 });
      const source = hold.sources?.[0] || null;
      charge.source = source || (hold.customerManaged ? "customer" : "none");
      charge.paise = source === "wallet" ? hold.sellPaise || 0 : 0;
    }
  } catch (error) {
    await Call.deleteOne({_id:call._id, status:"PROCESSING"});
    throw error;
  }
  let providerAccepted = false;
  const reserved = Boolean(hold?.sources?.[0]);

  try {
    const credentials = { accessToken: account.accessToken, phoneNumberId: account.phoneNumberId };
    const meta = kind === "text"
      ? await cloud.sendTextMessage(to, textBody, credentials)
      : await cloud.sendTemplateMessage(to, templateName, language, components, credentials);
    const metaMessageId = meta?.messages?.[0]?.id || null;
    providerAccepted = true;
    await Call.updateOne({_id:call._id},{$set:{metaMessageId,status:"SENT",billSource:charge.source,billPaise:charge.paise}});
    const message = await Message.create({
      to,
      phoneNumberId: account.phoneNumberId,
      direction: "OUTBOUND",
      type: kind === "text" ? "TEXT" : "TEMPLATE",
      textBody: textBody.slice(0, 1000),
      templateName,
      source: "API",
      metaMessageId,
      status: "SENT",
      sentAt: new Date(),
      billingState: reserved ? "reserved" : "none",
      billCategory: category,
      billSource: reserved ? hold.sources[0] : null,
      billPaise: charge.paise,
      billUserId: user._id,
    });
    await Call.updateOne({_id:call._id},{$set:{messageId:message._id}});
    await Key.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() }, $inc: { callCount: 1 } });
    return {
      id: String(message._id),
      metaMessageId,
      to,
      status: "SENT",
      category,
      charge: { source: charge.source, rupees: Number((charge.paise / 100).toFixed(2)) },
    };
  } catch (error) {

    if (!providerAccepted) {
      if (hold) await billing.releaseHold(hold).catch(() => {});
      await Call.updateOne({_id:call._id},{$set:{status:"FAILED",errorMessage:"Provider request failed"}});
    }
    throw fail(error.status || 502, error.message || "WhatsApp did not accept the message");
  }
}

async function notifyStatus(message, status) {
  if (!message || message.source !== "API" || !message.billUserId) return;
  await Call.updateOne(
    { messageId: message._id },
    { $set: { status } }
  );
  const hook = await Hook.findOne({ userId: message.billUserId, enabled: true }).lean();
  if (!hook?.url || !hook.secret) return;
  const payload = JSON.stringify({
    event: "message.status",
    id: String(message._id),
    metaMessageId: message.metaMessageId || null,
    status,
    to: message.to || "",
    at: new Date().toISOString(),
  });
  const signature = signBody(hook.secret, payload);
  await axios.post(hook.url, payload, {
    headers: {
      "Content-Type": "application/json",
      "X-MarketingKart-Signature": `sha256=${signature}`,
    },
    timeout: 4000,
    maxRedirects: 0,
  });
}

async function accountView(user) {
  const account = await Account.findOne({userId:user._id}).select("phoneNumber status verifiedName accountReviewStatus codeVerificationStatus").lean();
  return {
    name:user.name || "", phoneNumber:account?.phoneNumber || null,
    numberStatus:account?.status || "DISCONNECTED", verifiedName:account?.verifiedName || null,
    accountReviewStatus:account?.accountReviewStatus || null, codeVerificationStatus:account?.codeVerificationStatus || null,
    apiPackage:await contract.read(user._id),
    billing:(await contract.hasActive(user._id, "whatsapp")) ? "api_package" : "wallet",
  };
}

async function templateView(user) {
  const rows = await Template.find({ createdBy: user._id, disable: false })
    .select("name language status category")
    .sort({ name: 1 })
    .limit(100)
    .lean();
  return rows.map((row) => ({
    name: row.name,
    language: row.language,
    status: row.status,
    category: row.category,
  }));
}

module.exports = {
  ACTIVE_KEY_LIMIT,
  fail,
  isAdmin,
  hashKey,
  generateKey,
  normalizeTo,
  signBody,
  assertPublicHttps,
  fillDays,
  createKey,
  listKeys,
  revokeKey,
  regenerateKey,
  authenticate,
  desk,
  listCalls,
  messageDetail,
  directory,
  seriesFor,
  getWebhook,
  saveWebhook,
  rotateWebhookSecret,
  sendForProject,
  notifyStatus,
  accountView,
  templateView,
};
