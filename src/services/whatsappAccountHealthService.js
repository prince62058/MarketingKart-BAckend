const crypto = require("crypto");
const axios = require("axios");
const Account = require("../models/whatsappAccountModel");
const { dispatchNotification } = require("../helpers/appNotificationHelper");

const HEALTH_FIELDS = ["phone_number_quality_update", "account_review_update", "account_alerts"];
// Meta retries a webhook for up to ~36h; inside this window a repeat must not notify twice.
const DEDUP_WINDOW_MS = 48 * 60 * 60 * 1000;

const digits = (x) => String(x || "").replace(/\D/g, "");

function limitLabel(tier) {
  const raw = String(tier || "").toUpperCase();
  if (!raw) return null;
  if (raw.includes("UNLIMITED")) return "unlimited";
  const match = raw.match(/^TIER_(\d+)(K?)$/);
  if (!match) return raw;
  const count = Number(match[1]) * (match[2] ? 1000 : 1);
  return `${count.toLocaleString("en-IN")} business-initiated conversations per 24 hours`;
}

function describeChange(field, value, phone) {
  if (field === "phone_number_quality_update") {
    const limit = limitLabel(value.current_limit);
    const set = { qualityEvent: value.event || null };
    if (value.current_limit) set.messagingLimit = String(value.current_limit);
    const notices = {
      FLAGGED: {
        severity: "WARNING",
        title: "⚠️ WhatsApp number quality dropped",
        message: `Meta flagged ${phone} for low message quality. Avoid messaging people who did not opt in, or your messaging limit may be lowered.`,
      },
      UNFLAGGED: {
        severity: "INFO",
        title: "✅ WhatsApp number quality restored",
        message: `Message quality for ${phone} is back to normal.`,
      },
      DOWNGRADE: {
        severity: "CRITICAL",
        title: "📉 WhatsApp messaging limit lowered",
        message: `Meta lowered the messaging limit for ${phone}${limit ? ` to ${limit}` : ""} because of low message quality.`,
      },
      UPGRADE: {
        severity: "INFO",
        title: "📈 WhatsApp messaging limit increased",
        message: `The messaging limit for ${phone} is now ${limit || "higher"}.`,
      },
    };
    return { set, event: value.event || "UNKNOWN", refreshQuality: true, notice: notices[value.event] || null };
  }

  if (field === "account_review_update") {
    const decision = value.decision || "UNKNOWN";
    const notices = {
      APPROVED: {
        severity: "INFO",
        title: "✅ WhatsApp Business account approved",
        message: "Meta approved your WhatsApp Business account. You can now send messages.",
      },
      REJECTED: {
        severity: "CRITICAL",
        title: "❌ WhatsApp Business account rejected",
        message: "Meta rejected your WhatsApp Business account. Open WhatsApp Manager to see the reason and request a review.",
      },
    };
    return { set: { accountReviewStatus: decision }, event: decision, notice: notices[decision] || null };
  }

  const info = value.alert_info || {};
  const severity = String(info.alert_severity || "INFORMATIONAL").toUpperCase();
  const active = String(info.alert_status || "").toUpperCase() === "ACTIVE";
  const notify = active && (severity === "CRITICAL" || severity === "WARNING");
  return {
    set: {},
    event: info.alert_type || "ACCOUNT_ALERT",
    notice: notify
      ? {
          severity,
          title: severity === "CRITICAL" ? "🚨 WhatsApp account alert" : "⚠️ WhatsApp account alert",
          message: info.alert_description || `Meta raised a ${info.alert_type || "new"} alert on your WhatsApp account.`,
        }
      : null,
  };
}

async function fetchQuality(account) {
  const version = process.env.META_GRAPH_API_VERSION || "v22.0";
  const response = await axios.get(`https://graph.facebook.com/${version}/${account.phoneNumberId}`, {
    params: { fields: "quality_rating" },
    headers: { Authorization: `Bearer ${account.accessToken}` },
    timeout: 15000,
  });
  return response.data?.quality_rating || null;
}

const defaultDeps = { Account, notify: dispatchNotification, fetchQuality, io: () => global.io };

async function handleHealthChange({ wabaId, field, value = {} }, deps = defaultDeps) {
  if (!HEALTH_FIELDS.includes(field)) return { skipped: "field" };

  let accounts = await deps.Account.find({ wabaId: String(wabaId) }).limit(5);
  const webhookPhone = digits(value.display_phone_number);
  if (webhookPhone) {
    // A WABA can hold numbers that are not connected here; only alert about the connected one.
    accounts = accounts.filter((a) => !a.phoneNumber || digits(a.phoneNumber) === webhookPhone);
  }
  // Never send one tenant's account alerts to another tenant.
  if (accounts.length !== 1) return { skipped: "mapping" };
  const account = accounts[0];

  const phone = account.phoneNumber || value.display_phone_number || "your WhatsApp number";
  const change = describeChange(field, value, phone);
  const now = new Date();
  const key = crypto.createHash("sha256").update(field + JSON.stringify(value)).digest("hex");

  const set = { ...change.set };
  if (change.refreshQuality && account.phoneNumberId) {
    try {
      const rating = await deps.fetchQuality(account);
      if (rating) set.qualityRating = rating;
    } catch (err) {
      console.warn(`[WA Health] quality refresh failed for ${account.phoneNumberId}:`, err.message);
    }
  }

  const result = await deps.Account.updateOne(
    {
      _id: account._id,
      healthEvents: { $not: { $elemMatch: { key, receivedAt: { $gt: new Date(now - DEDUP_WINDOW_MS) } } } },
    },
    {
      $set: set,
      $push: {
        healthEvents: {
          $each: [{ key, field, event: change.event, severity: change.notice?.severity || "INFO", message: change.notice?.message || null, receivedAt: now }],
          $slice: -20,
        },
      },
    }
  );
  if (!result.matchedCount) return { skipped: "duplicate" };

  const payload = { field, event: change.event, ...set, notice: change.notice };
  deps.io()?.to(`user:${account.userId}`).emit("whatsappAccountHealth", payload);

  if (change.notice) {
    await deps.notify({
      userId: account.userId,
      title: change.notice.title,
      message: change.notice.message,
      type: "whatsapp",
      metadata: { field, event: change.event, severity: change.notice.severity, wabaId: String(wabaId) },
      customData: { field, event: String(change.event) },
    });
  }
  return { applied: true, notified: Boolean(change.notice), set };
}

module.exports = { HEALTH_FIELDS, handleHealthChange, limitLabel };
