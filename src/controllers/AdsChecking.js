const axios = require("axios");
const cron = require("node-cron");
const internalCampaignModel = require("../models/internalCampiagnModel");
const userModel = require("../models/userModel");
const { sendNotificationToMultipleTokens } = require("./notificationController");

const ACCESS_TOKEN = process.env.systemUserAccessToken; // Meta system user token
const API_VERSION = "v22.0";
const GST_RATE = 0.18;
const BUDGET_THRESHOLD = 0.95; // 95%

/**
 * Pause campaign
 */
async function pauseCampaign(campaignId) {
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${campaignId}`;
    await axios.post(url, { status: "PAUSED", access_token: ACCESS_TOKEN });
    console.log(`✅ Campaign paused: ${campaignId}`);
  } catch (error) {
    console.error(`❌ Error pausing campaign ${campaignId}:`, error.response?.data || error.message);
  }
}

/**
 * Pause ad set
 */
async function pauseAdSet(adSetId) {
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${adSetId}`;
    await axios.post(url, { status: "PAUSED", access_token: ACCESS_TOKEN });
    console.log(`✅ Ad Set paused: ${adSetId}`);
  } catch (error) {
    console.error(`❌ Error pausing ad set ${adSetId}:`, error.response?.data || error.message);
  }
}

/**
 * Pause ad
 */
async function pauseAd(adId) {
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${adId}`;
    await axios.post(url, { status: "PAUSED", access_token: ACCESS_TOKEN });
    console.log(`✅ Ad paused: ${adId}`);
  } catch (error) {
    console.error(`❌ Error pausing ad ${adId}:`, error.response?.data || error.message);
  }
}

/**
 * Fetch ad sets from campaign
 */
async function getAdSets(campaignId) {
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${campaignId}/adsets?fields=id&access_token=${ACCESS_TOKEN}`;
    const res = await axios.get(url);
    return res.data.data || [];
  } catch (error) {
    console.error(`❌ Error fetching ad sets for campaign ${campaignId}:`, error.response?.data || error.message);
    return [];
  }
}

/**
 * Fetch ads from ad set
 */
async function getAdsFromAdSet(adSetId) {
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${adSetId}/ads?fields=id&access_token=${ACCESS_TOKEN}`;
    const res = await axios.get(url);
    return res.data.data || [];
  } catch (error) {
    console.error(`❌ Error fetching ads for ad set ${adSetId}:`, error.response?.data || error.message);
    return [];
  }
}

/**
 * Get ad set insights (reach, impressions, clicks, spend, actions)
 */
async function getAdSetInsights(adSetId) {
  try {
    const url = `https://graph.facebook.com/${API_VERSION}/${adSetId}/insights?date_preset=maximum&access_token=${ACCESS_TOKEN}&fields=reach,impressions,clicks,spend,actions`;
    const res = await axios.get(url);

    const data = res.data?.data?.[0] || {};
    return {
      reach: parseInt(data.reach || 0),
      impressions: parseInt(data.impressions || 0),
      clicks: parseInt(data.clicks || 0),
      spend: parseFloat(data.spend || 0),
      actions: data.actions || []
    };
  } catch (error) {
    console.error(`❌ Error fetching insights for ad set ${adSetId}:`, error.response?.data || error.message);
    return {
      reach: 0,
      impressions: 0,
      clicks: 0,
      spend: 0,
      actions: []
    };
  }
}

/**
 * Pause campaign + ad sets + ads
 */
async function pauseEverythingInCampaign(campaignId) {
  console.log(`🚀 Pausing everything in campaign ${campaignId}...`);
  await pauseCampaign(campaignId);

  const adSets = await getAdSets(campaignId);
  for (const adSet of adSets) {
    await pauseAdSet(adSet.id);
    const ads = await getAdsFromAdSet(adSet.id);
    for (const ad of ads) {
      await pauseAd(ad.id);
    }
  }
  console.log(`🎯 All paused for campaign ${campaignId}`);
}

/**
 * Send push notification to user
 */
async function sendPushNotification(campaign, spend, leads, reach) {
  try {
    const user = await userModel.findById(campaign?.businessId?.userId).select("fcm").lean();
    if (user?.fcm) {
      const spendWithGst = spend * (1 + GST_RATE);
      const notification = {
        title: "📢 Campaign Completed!",
        body: `Your campaign ${campaign.campaignId} has ended.\n` +
              `📈 Leads: ${leads}\n` +
              `👥 Reach: ${reach}\n` +
              `💰 Spend (incl. GST): ₹${spendWithGst.toFixed(2)}`
      };
      await sendNotificationToMultipleTokens([user.fcm], notification);
      console.log(`📩 Notification sent to user ${user._id} for campaign ${campaign._id}`);
    }
  } catch (err) {
    console.error(`❌ Error sending push notification for campaign ${campaign._id}:`, err.message);
  }
}

/**
 * Run job every 15 minutes
 */
cron.schedule("*/15 * * * *", async () => {
  console.log("⏳ Running scheduled campaign budget check...");

  const campaigns = await internalCampaignModel.find({
    status: "ACTIVE",
  }).populate("businessId", "userId").lean();

  for (const campaign of campaigns) {
    if (!campaign.campaignId || !campaign.totalBudget) {
      console.log(`⚠️ Skipping campaign ${campaign._id} - Missing ID or budget`);
      continue;
    }

    // Get ad sets and sum their insights
    const adSets = await getAdSets(campaign.campaignId);
    let totalReach = 0;
    let totalLeads = 0;
    let totalSpend = 0;

    for (const adSet of adSets) {
      const insights = await getAdSetInsights(adSet.id);
      totalReach += insights.reach;
      totalSpend += insights.spend;

      const leadAction = insights.actions?.find(a => a.action_type === "lead");
      if (leadAction) {
        totalLeads += parseInt(leadAction.value || 0);
      }
    }

    const spendWithGst = totalSpend * (1 + GST_RATE);
    console.log(`📊 Campaign ${campaign.campaignId}: Leads=${totalLeads}, Reach=${totalReach}, SpendWithGST=₹${spendWithGst.toFixed(2)} / Budget=₹${campaign.totalBudget}`);

    // Budget threshold check
    if (spendWithGst >= campaign.totalBudget * BUDGET_THRESHOLD) {
      console.log(`🚨 Budget limit reached for campaign ${campaign.campaignId}. Pausing...`);
      await pauseEverythingInCampaign(campaign.campaignId);

      await internalCampaignModel.updateOne(
        { _id: campaign._id },
        { status: "COMPLETED" }
      );

      await sendPushNotification(campaign, totalSpend, totalLeads, totalReach);
    }
  }
});
