const admin = require("firebase-admin");
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

    // 1. Resolve User and Tokens
    let user = null;
    if (typeof userId === "object" && userId._id) {
      user = userId;
    } else {
      user = await User.findById(userId).select("_id fcm adminFcm name mobile email").lean();
    }

    if (!user) return null;

    // 2. Save In-App Notification in MongoDB
    let notifDoc = null;
    try {
      notifDoc = await Notification.create({
        userId: user._id,
        businessId: businessId || null,
        title,
        message,
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
            const resp = await admin.messaging().send({
              token,
              notification: {
                title,
                body: message,
              },
              data: {
                type: String(type).toUpperCase(),
                title: String(title),
                body: String(message),
                ...Object.fromEntries(
                  Object.entries(customData).map(([k, v]) => [k, String(v ?? "")])
                ),
              },
              android: {
                priority: "high",
                notification: {
                  channelId: "alerts",
                  sound: "default",
                  priority: "max",
                  defaultVibrateTimings: true,
                  defaultSound: true,
                },
              },
              apns: {
                payload: {
                  aps: {
                    sound: "default",
                    badge: 1,
                  },
                },
              },
            });
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

module.exports = {
  dispatchNotification,
  sendWalletNotification,
  sendLeadNotification,
  sendAdStatusNotification,
};
