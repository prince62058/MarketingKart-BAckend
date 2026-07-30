const internalCampaignModel = require("../models/internalCampiagnModel");
const userModel = require("../models/userModel");
const mongoose = require("mongoose");
const { sendNotificationToMultipleTokens } = require("./notificationController");

function getCurrentTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

async function manageCampaigns() {
  try {
    const now = new Date();
    const currentTime = getCurrentTime();
    const [currentHour, currentMinute] = currentTime.split(":").map(Number);

    // Fetch all campaigns
    const campaigns = await findAllInternalCampaigns();
    for (const campaign of campaigns) {
      // Safe guard: check if campaign or required nested fields exist
      if (!campaign || !campaign.businessId) continue;

      const startDate = new Date(campaign.startDate);
      const endDate = new Date(campaign.endDate);
      const dayStartTime = campaign.dayStartTime || "00:00";
      const dayEndTime = campaign.dayEndTime || "23:59";

      const [dayStartHour, dayStartMinute] = dayStartTime.split(":").map(Number);
      const [dayEndHour, dayEndMinute] = dayEndTime.split(":").map(Number);

      // Check if current date is within campaign period
      if (now >= startDate && now <= endDate) {
        // Check if current time is within daily active window
        const isExactStartTime =
          currentHour == dayStartHour && currentMinute == dayStartMinute;

        if (isExactStartTime) {
          // Update status to ACTIVE if not already
          if (campaign.status !== "ACTIVE") {
            await updateCampaignStatus(campaign._id, "ACTIVE");

            // Send start notification only if not sent and at exact start time
            // Safe guard: null check for addTypeId
            const addTypeIdStr = campaign.addTypeId?.toString() || "";
            const isLeadAd =
              addTypeIdStr === "676bd7b708acbc4f1ca6a8b6" ||
              addTypeIdStr === "676bd7b708acbc4f1ca6a8b5";
            if (
              isExactStartTime &&
              !campaign.startNotificationSent &&
              (!isLeadAd || (isLeadAd && campaign.status == "IN_PROGRESS"))
            ) {
              const notification = {
                title: "Your Ad Is Running Now",
                description: "The ad is currently being displayed.",
                customData: "default",
              };
              await sendPushNotification(campaign, notification);
              // Mark start notification as sent
              await internalCampaignModel.findByIdAndUpdate(campaign._id, {
                $set: { startNotificationSent: true },
              });
            }
          }
        }
      } else if (now > endDate) {
        // Check if the campaign has ended at the exact end time
        const isExactEndTime =
          now.getDate() === endDate.getDate() &&
          now.getMonth() === endDate.getMonth() &&
          now.getFullYear() === endDate.getFullYear() &&
          currentHour === dayEndHour &&
          currentMinute === dayEndMinute &&
          now.getSeconds() < 5;

        if (campaign.status !== "COMPLETED" && campaign?.byAdmin == false) {
          await updateCampaignStatus(campaign._id, "COMPLETED");

          // Send end notification only if not sent and at exact end time
          // Safe guard: null check for addTypeId
          const addTypeIdStr = campaign.addTypeId?.toString() || "";
          const isLeadAd =
            addTypeIdStr === "676bd7b708acbc4f1ca6a8b6" ||
            addTypeIdStr === "676bd7b708acbc4f1ca6a8b5";
          if (
            isExactEndTime &&
            !campaign.endNotificationSent &&
            (!isLeadAd || (isLeadAd && campaign.status === "ACTIVE"))
          ) {
            const notification = {
              title: "Your Ad Has Run",
              description: "The ad has finished running.",
              customData: "default",
            };
            await sendPushNotification(campaign, notification);
            // Mark end notification as sent
            await internalCampaignModel.findByIdAndUpdate(campaign._id, {
              $set: { endNotificationSent: true },
            });
          }
        }
      } else {
        // Campaign hasn't started yet
        if (campaign.status !== "IN_PROGRESS" && campaign?.byAdmin == false) {
          console.log("Campaign is not in progress, updating to ");
          await updateCampaignStatus(campaign._id, "IN_PROGRESS");
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in manageCampaigns background task:", error.message);
  } finally {
    // Run again after 5 seconds - use finally to ensure recursion continues even if current run failed
    setTimeout(manageCampaigns, 5000);
  }
}

async function findAllInternalCampaigns() {
  return await internalCampaignModel
    .find({
      paymentStatus: "APPROVED",
      status: { $in: ["ACTIVE", "PAUSED", "IN_PROGRESS", "IN_REVIEW"] },
    })
    .populate("businessId", "userId")
    .lean();
}

async function updateCampaignStatus(campaignId, newStatus) {
  try {
    const result = await internalCampaignModel.findByIdAndUpdate(
      campaignId,
      { $set: { status: newStatus } },
      { new: true }
    );
    if (!result) {
      console.warn(`No campaign updated. ID may not exist: ${campaignId}`);
    } else {
      console.log(`Campaign ${campaignId} updated to status: ${newStatus}`);
    }
  } catch (err) {
    console.error(`Error updating campaign ${campaignId} to status: ${newStatus}`, err);
  }
}

async function sendPushNotification(campaign, notification) {
  try {
    const user = await userModel.findById(campaign.businessId.userId).select("fcm").lean();
    if (user?.fcm) {
      await sendNotificationToMultipleTokens([user.fcm], notification);
      console.log(`Push notification sent to user ${user._id} for campaign ${campaign._id}`);
    } else {
      console.warn(`No FCM token found for user ${campaign.businessId.userId}`);
    }
  } catch (err) {
    console.error(`Error sending push notification for campaign ${campaign._id}`, err);
  }
}

module.exports = { manageCampaigns };