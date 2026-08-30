const admin = require("firebase-admin");
const Notification = require("../models/notificationModel");
const User = require("../models/userModel");

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
 * Sends in-app and FCM push notification to user when wallet is credited or debited.
 * @param {Object} params
 * @param {Object} params.user - User document with _id, fcm, adminFcm, name, mobile
 * @param {'CREDIT'|'DEBIT'} params.type
 * @param {'MAIN'|'WHATSAPP'} params.walletType
 * @param {number} params.amount
 * @param {number} params.newBalance
 * @param {string} [params.description]
 */
async function sendWalletNotification({ user, type, walletType = "MAIN", amount, newBalance, description }) {
  try {
    if (!user || !user._id) return null;

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

    // 1. Create In-App Notification record in MongoDB
    let notifDoc = null;
    try {
      notifDoc = await Notification.create({
        userId: user._id,
        title,
        message,
        read: false,
        status: "pending",
        metadata: {
          type: "wallet",
          action: type,
          walletType,
          amount,
          newBalance,
          description,
        },
      });
    } catch (dbErr) {
      console.warn("Failed to create in-app notification doc:", dbErr.message);
    }

    // 2. Gather FCM Tokens
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

    // 3. Send Push Notification via Firebase if tokens exist
    if (tokens.size > 0 && admin.apps.length > 0) {
      const tokenList = Array.from(tokens);
      console.log(`[WalletNotification] Sending push to ${tokenList.length} device(s) for user ${user._id}`);

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
                type: "WALLET_UPDATE",
                walletType,
                action: type,
                amount: String(amount),
                newBalance: String(newBalance),
                title,
                body: message,
              },
              android: {
                priority: "high",
                notification: {
                  channelId: "alerts",
                  sound: "default",
                  priority: "max",
                },
              },
            });
            console.log(`[WalletNotification] FCM success for token ${token.substring(0, 15)}...:`, resp);
            if (notifDoc) {
              await Notification.findByIdAndUpdate(notifDoc._id, {
                status: "sent",
                fcmMessageId: resp,
              }).catch(() => {});
            }
          } catch (fcmErr) {
            console.error(`[WalletNotification] FCM error for token ${token.substring(0, 15)}...:`, fcmErr.message);
            if (isInvalidFcmTokenError(fcmErr)) {
              invalidTokens.push(token);
            }
          }
        })
      );

      // Clean up stale tokens if any were rejected
      if (invalidTokens.length > 0) {
        await User.findByIdAndUpdate(user._id, {
          $pull: { adminFcm: { $in: invalidTokens } },
          ...(invalidTokens.includes(user.fcm) ? { $unset: { fcm: "" } } : {}),
        }).catch(() => {});
      }
    }

    return notifDoc;
  } catch (error) {
    console.error("[WalletNotification] Error sending wallet notification:", error);
    return null;
  }
}

module.exports = {
  sendWalletNotification,
};
