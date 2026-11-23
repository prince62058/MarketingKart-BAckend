const admin = require("firebase-admin");
const { buildFcmMessage, notificationImage } = require("./fcmMessage");
const Notification = require("../models/notificationModel");
const User = require("../models/userModel");
const Business = require("../models/businessModel");

const isInvalidFcmTokenError = (error) => {
  const errorCode = error?.errorInfo?.code;
  if (
    errorCode === "messaging/registration-token-not-registered" ||
    errorCode === "messaging/invalid-registration-token" ||
    errorCode === "messaging/invalid-argument" ||
    errorCode === "messaging/mismatched-credential"
  ) {
    return true;
  }
  const message = error?.message || "";
  return message.includes("Requested entity was not found");
};

/**
 * Low-level dispatcher to save in-app Notification and send FCM push
 */
async function dispatchNotification({ userId, businessId, title, message, type = "system", metadata = {}, customData = {} }) {
  try {
    if (!userId) return null;

    // An ObjectId also has `_id` (it returns itself), so that check treated every
    // stored user id as a user document and skipped the device token entirely.
    const userKey =
      userId && typeof userId === "object" && userId._id && !userId._bsontype
        ? userId._id
        : userId;
    const user = await User.findById(userKey).select("_id fcm adminFcm name mobile email").lean();

    if (!user) return null;

    // 2. Save In-App Notification in MongoDB
    let notifDoc = null;
    try {
      notifDoc = await Notification.create({
        userId: user._id,
        businessId: businessId || null,
        title,
        message,
        image: notificationImage(metadata.image),
        read: false,
        status: "pending",
        metadata: {
          type,
          ...metadata,
        },
      });
    } catch (dbErr) {
      console.warn("[AppNotification] DB insert error:", dbErr.message);
    }

    // 3. Gather active FCM Tokens
    const tokens = new Set();
    if (user.fcm && typeof user.fcm === "string" && user.fcm.trim().length > 10) {
      tokens.add(user.fcm.trim());
    }
    if (Array.isArray(user.adminFcm)) {
      user.adminFcm.forEach((t) => {
        if (t && typeof t === "string" && t.trim().length > 10) {
          tokens.add(t.trim());
        }
      });
    }

    // 4. Send FCM Push Notification if Firebase is initialized
    if (tokens.size > 0 && admin.apps && admin.apps.length > 0) {
      const tokenList = Array.from(tokens);
      const invalidTokens = [];

      await Promise.all(
        tokenList.map(async (token) => {
          try {
            const resp = await admin.messaging().send(
              buildFcmMessage({
                token,
                title,
                body: message,
                image: metadata.image,
                data: {
                  type: String(type).toUpperCase(),
                  title: String(title),
                  body: String(message),
                  ...customData,
                },
              }),
            );
            console.log(`[AppNotification] FCM delivered (${type}) to user ${user._id}`);
            if (notifDoc) {
              await Notification.findByIdAndUpdate(notifDoc._id, {
                status: "sent",
                fcmMessageId: resp,
              }).catch(() => {});
            }
          } catch (fcmErr) {
            console.error(`[AppNotification] FCM error for user ${user._id}:`, fcmErr.message);
            if (isInvalidFcmTokenError(fcmErr)) {
              invalidTokens.push(token);
            }
          }
        })
      );

      // Clean invalid tokens
      if (invalidTokens.length > 0) {
        await User.findByIdAndUpdate(user._id, {
          $pull: { adminFcm: { $in: invalidTokens } },
          ...(invalidTokens.includes(user.fcm) ? { $unset: { fcm: "" } } : {}),
        }).catch(() => {});
      }
    }

    return notifDoc;
  } catch (err) {
    console.error("[AppNotification] Unexpected error:", err);
    return null;
  }
}

/**
 * 1. Wallet Top-Up / Debit Notification
 */
async function sendWalletNotification({ user, type, walletType = "MAIN", amount, newBalance, description }) {
  const formattedAmount = Number(amount || 0).toLocaleString("en-IN");
  const formattedBalance = Number(newBalance || 0).toLocaleString("en-IN");
  const isCredit = type === "CREDIT";
  const isWA = walletType === "WHATSAPP";

  const title = isCredit
    ? (isWA ? `💬 WhatsApp Wallet Recharged: +₹${formattedAmount}` : `💰 Wallet Recharged: +₹${formattedAmount}`)
    : (isWA ? `💬 WhatsApp Wallet Debited: -₹${formattedAmount}` : `📉 Wallet Debited: -₹${formattedAmount}`);

  const message = isCredit
    ? `₹${formattedAmount} has been credited to your ${isWA ? "WhatsApp" : "Main Ad"} wallet. Available Balance: ₹${formattedBalance}.${description ? ` (${description})` : ""}`
    : `₹${formattedAmount} has been deducted from your ${isWA ? "WhatsApp" : "Main Ad"} wallet. Available Balance: ₹${formattedBalance}.${description ? ` (${description})` : ""}`;

  return dispatchNotification({
    userId: user?._id || user,
    title,
    message,
    type: "payment",
    metadata: {
      action: type,
      walletType,
      amount,
      newBalance,
      description,
    },
    customData: {
      walletType,
      action: type,
      amount,
      newBalance,
    },
  });
}

/**
 * 2. Lead Arrival Notification
 */
async function sendLeadNotification({ userId, businessId, campaignId, campaignName, leadName, leadPhone, count = 1 }) {
  const title = count > 1 ? `🎯 ${count} New Leads Received!` : `🎯 New Lead: ${leadName || "Potential Customer"}`;
  const message = count > 1
    ? `You have received ${count} new leads for your campaign "${campaignName || "Ad Campaign"}". Open app to connect!`
    : `New lead from ${leadName || "Customer"}${leadPhone ? ` (${leadPhone})` : ""} for "${campaignName || "Ad Campaign"}". Tap to contact now.`;

  return dispatchNotification({
    userId,
    businessId,
    title,
    message,
    type: "lead",
    metadata: {
      campaignId,
      campaignName,
      leadName,
      leadPhone,
      count,
    },
    customData: {
      campaignId,
      leadPhone,
      leadName,
    },
  });
}

/**
 * 3. Ad Campaign Status Notification (Active, Paused, Approved, Completed)
 */
async function sendAdStatusNotification({ userId, businessId, campaignId, campaignName, status, reason }) {
  let title = "📢 Ad Campaign Update";
  let message = `Your campaign "${campaignName || "Ad Campaign"}" status is now: ${status}.`;

  if (status === "ACTIVE") {
    title = `🚀 Ad Campaign is Now Live!`;
    message = `Great news! "${campaignName || "Your Ad Campaign"}" is active and running. Start monitoring your leads and performance!`;
  } else if (status === "PAUSED") {
    title = `⏸️ Ad Campaign Paused`;
    message = `"${campaignName || "Your Ad Campaign"}" has been paused.${reason ? ` Reason: ${reason}` : ""}`;
  } else if (status === "COMPLETED") {
    title = `🎉 Ad Campaign Completed!`;
    message = `"${campaignName || "Your Ad Campaign"}" has finished running its schedule.`;
  } else if (status === "IN_REVIEW") {
    title = `⏳ Ad Under Review`;
    message = `"${campaignName || "Your Ad Campaign"}" is currently being reviewed and will go live shortly.`;
  }

  return dispatchNotification({
    userId,
    businessId,
    title,
    message,
    type: "ad",
    metadata: {
      campaignId,
      campaignName,
      status,
      reason,
    },
    customData: {
      campaignId,
      status,
    },
  });
}

function clip(text, limit = 90) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/**
 * WhatsApp template submitted, approved, rejected, paused, or disabled.
 */
async function sendTemplateStatusNotification({ userId, templateId, templateName, status, reason }) {
  const name = templateName || "Template";
  const outcome = String(status || "").toUpperCase();
  const copy = {
    PENDING: [`Template submitted: ${name}`, "WhatsApp is reviewing this template. You will get another alert when it is approved."],
    APPROVED: [`Template approved: ${name}`, "WhatsApp approved this template. You can use it in campaigns now."],
    REJECTED: [`Template rejected: ${name}`, reason ? `WhatsApp rejected this template. ${clip(reason)}` : "WhatsApp rejected this template. Open Templates to see why."],
    PAUSED: [`Template paused: ${name}`, "WhatsApp paused this template. New sends will wait until it is active again."],
    DISABLED: [`Template disabled: ${name}`, "WhatsApp disabled this template."],
  };
  const [title, message] = copy[outcome] || [`Template update: ${name}`, `Status is now ${outcome || "updated"}.`];

  return dispatchNotification({
    userId,
    title,
    message,
    type: "template",
    metadata: { templateId, templateName: name, status: outcome, reason },
    customData: { templateId, status: outcome },
  });
}

/**
 * A customer message landed in the inbox.
 */
async function sendWhatsAppInboundNotification({ userId, businessId, conversationId, customerName, customerPhone, preview }) {
  const who = customerName && customerName !== "Unknown" ? customerName : (customerPhone || "a customer");
  const body = clip(preview) || "Open the chat to read it.";
  return dispatchNotification({
    userId,
    businessId,
    title: `WhatsApp from ${who}`,
    message: body,
    type: "whatsapp",
    metadata: { conversationId, customerName, customerPhone, event: "inbound" },
    customData: { conversationId, event: "inbound" },
  });
}

/**
 * An outbound chat message reached the customer, or WhatsApp said it failed.
 * Campaign blasts are counted on the campaign screen, not pushed one by one.
 */
async function sendWhatsAppDeliveryNotification({ userId, businessId, conversationId, contactName, phone, preview, failed, errorMessage }) {
  const who = contactName || phone || "the customer";
  const title = failed ? "WhatsApp not delivered" : "WhatsApp delivered";
  const message = failed
    ? `Your message to ${who} was not delivered.${errorMessage ? ` ${clip(errorMessage, 70)}` : ""}`
    : `Your message to ${who} was delivered.${preview ? ` “${clip(preview, 60)}”` : ""}`;

  return dispatchNotification({
    userId,
    businessId,
    title,
    message,
    type: "whatsapp",
    metadata: { conversationId, contactName, phone, event: failed ? "failed" : "delivered" },
    customData: { conversationId, event: failed ? "failed" : "delivered" },
  });
}

/**
 * An AI video finished rendering.
 */
async function sendVideoReadyNotification({ userId, projectId, title }) {
  const name = clip(title, 60) || "Your video";
  return dispatchNotification({
    userId,
    title: "AI video is ready",
    message: `${name} has finished. Open AI Video to watch it.`,
    type: "video",
    metadata: { projectId, title: name },
    customData: { projectId },
  });
}

module.exports = {
  dispatchNotification,
  sendWalletNotification,
  sendLeadNotification,
  sendAdStatusNotification,
  sendTemplateStatusNotification,
  sendWhatsAppInboundNotification,
  sendWhatsAppDeliveryNotification,
  sendVideoReadyNotification,
};
