const Notification = require("../models/notificationModel");
const User = require("../models/userModel");
const Business = require("../models/businessModel");
const InternalCampaign = require("../models/internalCampiagnModel");

const admin = require("firebase-admin");
const serviceAccount = require("../config/firebase.json");

// Initialize the Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

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

const sendNotificationToMultipleTokens = async (
  tokens,
  notificationPayload
) => {
  try {
    console.log("Sending notifications to multiple tokens...");

    const invalidTokens = new Set();
    const responses = await Promise.all(
      tokens.map(async (token) => {
        try {
          const response = await admin.messaging().send({
            token,
            notification: {
              title: notificationPayload.length
                ? notificationPayload[0].title
                : notificationPayload.title,
              body: notificationPayload.length
                ? notificationPayload[0].description
                : notificationPayload.description,
            },
            android: {
              notification: {
                channelId: "alerts", // Match the channel ID in Flutter
              },
            },

            data: {
              customKey: notificationPayload.customData || "default",
            },
          });
          return { token, success: true, response };
        } catch (error) {
          console.error(
            `Error sending notification to token ${token}:`,
            error.message
          );
          if (isInvalidFcmTokenError(error)) {
            invalidTokens.add(token);
          }
          return { token, success: false, error: error.message };
        }
      })
    );

    if (invalidTokens.size) {
      const tokensToRemove = Array.from(invalidTokens);
      await User.updateMany(
        {
          $or: [
            { fcm: { $in: tokensToRemove } },
            { adminFcm: { $in: tokensToRemove } },
          ],
        },
        {
          $pull: {
            fcm: { $in: tokensToRemove },
            adminFcm: { $in: tokensToRemove },
          },
        }
      );
      console.warn(
        `Removed ${tokensToRemove.length} invalid FCM token(s) from user records`,
        tokensToRemove
      );
    }

    console.log("Notifications sent to all tokens!");
    console.log("Responses:", responses);
    return responses;
  } catch (error) {
    console.error("Error while sending notifications:", error.message);
    console.error("Error details:", error);
    throw error;
  }
};

const sendNotificationToMultipleToken = async (
  tokens,
  notificationPayload,
  newLeadsCount
) => {
  try {
    console.log("Sending notifications to", tokens?.length, "tokens");

    const responses = await Promise.all(
      tokens.map(async (token) => {
        try {
          const response = await admin.messaging().send({
            token,
            // Visible notification for heads-up display
            notification: {
              title: notificationPayload?.title || "New Lead Received",
              body: notificationPayload?.description || `You have ${newLeadsCount} new lead(s) from your ads`,
            },
            // Data payload for app handling
            data: {
              customKey: notificationPayload.customData || "default",
              type: newLeadsCount ? "Lead" : "FollowUp",
              count: `${newLeadsCount}` || "0",
              title: notificationPayload?.title || "New Lead Received",
              description: notificationPayload?.description || `You have ${newLeadsCount} new lead(s) from your ads`,
            },
            android: {
              priority: "high",
              notification: {
                channelId: "alerts",
                sound: "default",
                icon: "notification_icon",
                color: "#1a73e8",
                clickAction: "FLUTTER_NOTIFICATION_CLICK",
              },
            },
          });
          return { token, success: true, response };
        } catch (error) {
          console.error(
            `Error sending notification to token ${token}:`,
            error.message
          );
          if (isInvalidFcmTokenError(error)) {
            // Clean up invalid tokens
            await User.updateMany(
              { fcm: token },
              { $set: { fcm: null } }
            );
            console.warn(`Removed invalid FCM token: ${token}`);
          }
          return { token, success: false, error: error.message };
        }
      })
    );

    console.log("Notifications sent to all tokens!");
    console.log("Responses:", responses);
  } catch (error) {
    console.error("Error while sending notifications:", error.message);
    console.error("Error details:", error);
    throw error;
  }
};
// Function to send notification to all users
const sendNotificationToAllUsersBusiness = async (req, res) => {
  try {
    const { title, message } = req.body;
    const businesses = await Business.find().select("userId");
    const tokens = await User.find({
      _id: { $in: businesses.map((b) => b.userId) },
    }).select("fcm");

    const notificationPayload = {
      title,
      description: message,
      customData: "default",
    };

    await sendNotificationToMultipleTokens(
      tokens.map((t) => t.fcm),
      notificationPayload
    );

    const notifications = businesses.map((business) => ({
      userId: business?.userId,
      title,
      message,
      businessId: business?._id,
      image: req.file?.location,
    }));

    await Notification.insertMany(notifications);

    res
      .status(200)
      .json({ success: true, message: "Notifications sent to all users" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Function to send notification to users of a specific business
const sendNotificationToBusinessUsers = async (req, res) => {
  try {
    const { businessId, title, message } = req.body;
    const business = await Business.findById(businessId).select("userId");
    const tokens = await User.find({ _id: business.userId }).select("fcm");

    const notificationPayload = {
      title,
      description: message,
      customData: "default",
    };

    await sendNotificationToMultipleToken(
      tokens.map((t) => t.fcm),
      notificationPayload
    );

    if (business) {
      const notification = new Notification({
        userId: business.userId,
        title,
        message,
        businessId,
        // image: req.file?.location,
      });
      await notification.save();

      res
        .status(200)
        .json({
          success: true,
          message: "Notifications sent to business users",
        });
    } else {
      res.status(404).json({ success: false, message: "Business not found" });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Sends a notification to a single user or business owner
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} JSON response with success status and message
 */
const sendNotificationToSingleUserAndBusiness = async (req, res) => {
  const startTime = Date.now();
  const { userId, title, message } = req.body;
  const requestId = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Log the incoming request
  console.log(`[${new Date().toISOString()}] [${requestId}] Notification request received`, {
    userId,
    title: title?.substring(0, 50) + (title?.length > 50 ? '...' : ''),
    messageLength: message?.length || 0
  });

  try {
    // Validate required fields
    if (!userId || !title?.trim() || !message?.trim()) {
      const error = new Error('Missing required fields');
      error.statusCode = 400;
      error.details = { 
        hasUserId: !!userId, 
        hasTitle: !!title,
        hasMessage: !!message 
      };
      throw error;
    }

    // Validate userId is a valid MongoDB ObjectId
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      const error = new Error('Invalid userId format. Must be a valid MongoDB ObjectId.');
      error.statusCode = 400;
      throw error;
    }

    // 1️⃣ First try to find user by ID
    let user = await User.findById(userId).select('fcm firstName lastName email isActive').lean();
    
    // 2️⃣ If user not found, try to find business and get its owner
    if (!user) {
      console.log(`[${requestId}] User not found, trying to find business with ID: ${userId}`);
      const business = await Business.findById(userId).select('userId businessName').lean();
      
      if (!business) {
        const error = new Error('No matching user or business found');
        error.statusCode = 404;
        throw error;
      }

      console.log(`[${requestId}] Found business: ${business.businessName}, owner ID: ${business.userId}`);
      user = await User.findById(business.userId).select('fcm firstName lastName email isActive').lean();
      
      if (!user) {
        const error = new Error('Business owner not found');
        error.statusCode = 404;
        error.details = { businessId: userId, ownerId: business.userId };
        throw error;
      }
    }

    // 3️⃣ Validate user and FCM token
    if (!user.fcm) {
      const error = new Error('User does not have a valid FCM token');
      error.statusCode = 400;
      error.details = { 
        userId: user._id,
        email: user.email,
        isActive: user.isActive
      };
      throw error;
    }

    if (user.isActive === false) {
      const error = new Error('User account is inactive');
      error.statusCode = 403;
      throw error;
    }

    // 4️⃣ Prepare notification payload with additional metadata
    const notificationPayload = {
      notification: {
        title: String(title).substring(0, 100),
        body: String(message).substring(0, 500),
      },
      data: {
        type: 'direct_notification',
        timestamp: new Date().toISOString(),
        customData: JSON.stringify({
          notificationType: 'single_user',
          source: 'api'
        })
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'alerts',
          sound: 'default',
          icon: 'notification_icon',
          color: '#1a73e8',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
      token: user.fcm
    };

    console.log(`[${requestId}] Sending FCM to user ${user._id} (${user.email})`);
    
    // 5️⃣ Send notification via FCM
    let fcmResponse = null;
    let fcmFailed = false;
    let fcmError = null;
    try {
      fcmResponse = await admin.messaging().send(notificationPayload);
      console.log(`[${requestId}] FCM response:`, fcmResponse);
    } catch (fcmErr) {
      fcmFailed = true;
      fcmError = fcmErr;
      console.error(`[${requestId}] FCM send failed:`, fcmErr?.errorInfo?.code, fcmErr.message);
      
      // If token is invalid/mismatched, clear it from the user record
      if (isInvalidFcmTokenError(fcmErr)) {
        console.log(`[${requestId}] Clearing stale FCM token for user ${user._id}`);
        await User.findByIdAndUpdate(user._id, { $set: { fcm: null } });
      }
    }

    // 6️⃣ Save notification record (always save, even if FCM failed)
    const notification = new Notification({
      userId: user._id,
      title: notificationPayload.notification?.title || notificationPayload.data?.title || 'New Notification',
      message: notificationPayload.notification?.body || notificationPayload.data?.description || 'You have a new message',
      image: req.file?.location || null,
      fcmMessageId: fcmResponse,
      status: fcmFailed ? 'failed' : 'sent',
      metadata: {
        platform: 'fcm',
        requestId,
        deliveryAttempts: 1,
        ...(fcmFailed && { fcmError: fcmError?.errorInfo?.code || fcmError?.message })
      }
    });

    await notification.save();

    // 7️⃣ Send success response
    const responseTime = Date.now() - startTime;
    
    if (fcmFailed) {
      console.log(`[${requestId}] Notification saved but FCM delivery failed in ${responseTime}ms`);
      return res.status(200).json({
        success: true,
        message: `Notification saved but push delivery failed: ${fcmError?.message || 'Check FCM configuration'}.`,
        data: {
          notificationId: notification._id,
          userId: user._id,
          timestamp: new Date(),
          fcmDelivered: false
        },
        meta: {
          requestId,
          responseTime: `${responseTime}ms`
        }
      });
    }

    console.log(`[${requestId}] Notification sent successfully in ${responseTime}ms`);
    
    return res.status(200).json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        notificationId: notification._id,
        fcmMessageId: fcmResponse,
        userId: user._id,
        timestamp: new Date()
      },
      meta: {
        requestId,
        responseTime: `${responseTime}ms`
      }
    });

  } catch (error) {
    const errorCode = error.code || error.statusCode || 500;
    const errorMessage = error.message || 'Failed to send notification';
    const errorDetails = error.details || {};
    
    console.error(`[${requestId}] Error: ${errorMessage}`, {
      errorCode,
      errorDetails,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      userId,
      requestBody: req.body
    });

    // Save failed notification attempt
    try {
      await Notification.create({
        userId: userId || null,
        title: title?.substring(0, 100) || 'Failed to send',
        message: errorMessage,
        status: 'failed',
        metadata: {
          error: errorMessage,
          errorCode,
          errorDetails,
          requestId,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      });
    } catch (dbError) {
      console.error(`[${requestId}] Failed to save failed notification:`, dbError);
    }

    // Map Firebase/System errors to numeric status codes
    const httpStatusCode = typeof errorCode === 'number' ? errorCode : 500;

    return res.status(httpStatusCode).json({
      success: false,
      message: errorMessage,
      error: {
        code: error.code || 'NOTIFICATION_ERROR',
        details: error.details || {},
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString()
      }
    });
  }
};

const sendNotificationToAllUsersWithCondition = async (req, res) => {
  try {
    const { title, message, userType, businessId } = req.body;

    if (!title || !message || !userType) {
      return res.status(400).json({
        success: false,
        message: "title, message & userType are required"
      });
    }

    // Get businesses mapped by userId
    const userBusinesses = await Business.find({})
      .select("_id userId isFacebookPageLinked")
      .lean();

    const businessMap = new Map(
      userBusinesses.map(b => [b.userId.toString(), b])
    );

    // Get users who have valid tokens
    let users = await User.find({ fcm: { $exists: true, $ne: null } })
      .select("_id fcm")
      .lean();

    let targetUsers = [];

    switch (userType) {
      case "businessUsers":
        targetUsers = users.filter(u => businessMap.has(u._id.toString()));
        break;

      case "nonBusinessUsers":
        targetUsers = users.filter(u => !businessMap.has(u._id.toString()));
        break;

      case "pageConnected":
        targetUsers = users.filter(u => {
          const b = businessMap.get(u._id.toString());
          return b && b.isFacebookPageLinked;
        });
        break;

      case "pageNotConnected":
        targetUsers = users.filter(u => {
          const b = businessMap.get(u._id.toString());
          return !b || !b.isFacebookPageLinked;
        });
        break;

      case "internalCampaignAds":
        if (!businessId) {
          return res.status(400).json({ success: false, message: "businessId required" });
        }

        const business = await Business.findById(businessId).select("userId").lean();
        if (!business) {
          return res.status(404).json({ success: false, message: "Business not found" });
        }

        targetUsers = users.filter(u => u._id.toString() === business.userId.toString());
        break;

      default:
        return res.status(400).json({ success: false, message: "Invalid userType" });
    }

    const tokens = targetUsers.map(u => u.fcm).filter(Boolean);

    // FCM Payload
    const payload = {
      notification: { title, body: message },
      data: { customKey: "default" }
    };

    // Send in chunks
    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);

      try {
        await admin.messaging().sendEachForMulticast({
          tokens: chunk,
          notification: payload.notification,
          data: payload.data
        });
      } catch (err) {
        // Remove invalid tokens
        await User.updateMany({ fcm: { $in: chunk } }, { $set: { fcm: null } });
      }
    }

    // Create Notification DB Records
    const notifications = targetUsers.map(u => ({
      userId: u._id,
      title,
      message,
      businessId: businessMap.get(u._id.toString())?._id || null,
      image: req.file?.location || null
    }));

    await Notification.insertMany(notifications);

    return res.status(200).json({
      success: true,
      message: `Notifications sent to ${tokens.length} users`,
      count: tokens.length
    });

  } catch (error) {
    console.log("Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send notifications",
      error: error.message
    });
  }
};


// Function to get notifications by userId and businessId (optional)
const getNotificationsByUserIdBusinessId = async (req, res) => {
  try {
    const { userId, businessId } = req.query;
    console.log("Fetching notifications for:", { userId, businessId });
    const query = {};

    if (userId) {
      query.userId = userId;
    }

    if (businessId) {
      query.$or = [{ businessId: businessId }, { businessId: { $exists: false } }, { businessId: null }];
    }

    const notifications = await Notification.find(query).sort({
      createdAt: -1,
    });

    // Mark notifications as read
    await Notification.updateMany(query, { $set: { read: true } });

    res.status(200).json({ success: true, notifications });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Function to get unread notifications count by businessId and userId (optional)
const getUnreadNotificationsCount = async (req, res) => {
  try {
    const { businessId, userId } = req.query;
    const query = { read: false };

    if (businessId) {
      query.$or = [{ businessId: businessId }, { businessId: { $exists: false } }, { businessId: null }];
    }

    if (userId) {
      query.userId = userId;
    }

    const unreadCount = await Notification.countDocuments(query);
    res.status(200).json({ success: true, unreadCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  sendNotificationToAllUsersBusiness,
  sendNotificationToBusinessUsers,
  getNotificationsByUserIdBusinessId,
  getUnreadNotificationsCount,
  sendNotificationToAllUsersWithCondition,
  sendNotificationToMultipleTokens,
  sendNotificationToMultipleToken,
  sendNotificationToSingleUserAndBusiness,
};


// const admin = require("firebase-admin");
const cron = require("node-cron");
const UserToken = require("../models/userModel");

// const serviceAccount = require("../config/firebase.json");

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });


async function checkUninstallUsers() {
  console.log(`\n⏳ Running uninstall check at ${new Date().toLocaleTimeString()}`);
  
  const users = await UserToken.find();
  let uninstallCount = 0;
  let uninstallUsers = [];

  for (const user of users) {
    try {
      await admin.messaging().send({
        token: user.fcm,
        data: {
          type: "ping",
          message: "Checking app status"
        }
      });
    } catch (error) {
      if (error.errorInfo?.code === "messaging/registration-token-not-registered") {
        uninstallCount++;
        uninstallUsers.push(user);
        await UserToken.updateOne({ _id: user._id }, { $set: { uninstalled: true } });
        //console.log(`❌ ${user.name} (${user.userId}) uninstalled the app.`);
      }
    }
  }

  console.log(`📊 Total Uninstalled Users This Run: ${uninstallCount}`);
  if (uninstallUsers.length > 0) {
    console.log(uninstallUsers);
  }
}

// 🕒 Schedule to run every day at midnight
cron.schedule("0 0 * * *", () => {
  checkUninstallUsers(); 
});

console.log("🚀 Uninstall detection scheduler started (Every day at midnight)");
