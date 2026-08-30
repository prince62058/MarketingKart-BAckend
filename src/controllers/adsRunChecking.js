const internalCampaignModel = require("../models/internalCampiagnModel");
const userModel = require("../models/userModel");
const mongoose = require("mongoose");
const { sendNotificationToMultipleTokens } = require("./notificationController");
const { sendAdStatusNotification } = require("../helpers/appNotificationHelper");
const { AD_KIND, resolveAdKind } = require("../helpers/adTypeHelper");

/**
 * True only when this campaign really is delivering on Meta.
 *
 * This scheduler moves the DB status; it never touches Meta. Marking a campaign
 * ACTIVE that Meta still has PAUSED makes the app show "Active" for an ad that
 * is spending nothing — so a campaign only counts as running once it has the
 * delivery ids that the admin approval flow creates.
 */
const hasLiveMetaDelivery = (campaign) =>
  Boolean((campaign.mainAdId || campaign.metaAdId) && campaign.facebookAdSetId);

// Lead Form and WhatsApp ads only count as "running" once Meta has them live,
// so their start/end notifications are gated differently from other ad types.
const isLeadStyleAd = async (campaign) => {
  const kind = await resolveAdKind(campaign.addTypeId);
  return kind === AD_KIND.LEAD_FORM || kind === AD_KIND.WHATSAPP;
};

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

        // An admin's explicit pause/activate is the source of truth and must not
        // be undone by the clock, and a campaign with no Meta delivery ids has
        // never gone live at all.
        const mayAutoActivate =
          campaign?.byAdmin !== true && hasLiveMetaDelivery(campaign);

        if (isExactStartTime && mayAutoActivate) {
          // Update status to ACTIVE if not already
          if (campaign.status !== "ACTIVE") {
            await updateCampaignStatus(campaign._id, "ACTIVE");

            // Send start notification only if not sent and at exact start time
            // Safe guard: null check for addTypeId
            const isLeadAd = await isLeadStyleAd(campaign);
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
          const isLeadAd = await isLeadStyleAd(campaign);
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
    const userId = campaign?.businessId?.userId || campaign?.businessId;
    if (userId) {
      await sendAdStatusNotification({
        userId,
        businessId: campaign?.businessId?._id || campaign?.businessId,
        campaignId: campaign._id,
        campaignName: campaign.campaignName || campaign.mainAdId,
        status: "COMPLETED",
      });
    }
  } catch (err) {
    console.error(`Error sending push notification for campaign ${campaign?._id}:`, err.message);
  }
}

module.exports = { manageCampaigns };