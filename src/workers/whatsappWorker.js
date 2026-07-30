const { Worker } = require("bullmq");
const { createRedisConnection } = require("../config/redisConfig");
const whatsappCloudApiService = require("../services/whatsappCloudApiService");
const whatsappMessageModel = require("../models/whatsappMessageModel");
const whatsappCampaignModel = require("../models/whatsappCampaignModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");

let worker = null;

const processJob = async (job) => {
  const {
    messageId,
    campaignId,
    to,
    templateName,
    languageCode,
    components,
  } = job.data;

  try {
    const campaign = await whatsappCampaignModel.findById(campaignId, "createdBy status businessId");
    if (!campaign) throw new Error("Campaign not found");

    if (campaign.status === "PAUSED") {
      console.log(`[WhatsApp Worker] Campaign ${campaignId} is paused. Preserving queued message ${messageId}.`);
      return;
    }

    const account = await whatsappAccountModel.findOne({ userId: campaign.createdBy, status: "CONNECTED" });
    if (!account) throw new Error("WhatsApp Account not connected for this user");

    const result = await whatsappCloudApiService.sendTemplateMessage(
      to,
      templateName,
      languageCode,
      components,
      { accessToken: account.accessToken, phoneNumberId: account.phoneNumberId }
    );

    const wamid = result?.messages?.[0]?.id;

    const whatsappConversationModel = require("../models/whatsappConversationModel");
    const businessModel = require("../models/businessModel");

    // Resolve businessId — fallback to user's first business if campaign doesn't have one
    let resolvedBusinessId = campaign.businessId;
    if (!resolvedBusinessId) {
      const userBusiness = await businessModel.findOne({ userId: campaign.createdBy }).select("_id");
      resolvedBusinessId = userBusiness?._id || null;
      if (resolvedBusinessId) {
        // Save it back to the campaign so future messages don't need this lookup
        await whatsappCampaignModel.findByIdAndUpdate(campaignId, { businessId: resolvedBusinessId });
      }
    }

    let conversation = await whatsappConversationModel.findOne({
      phoneNumberId: account.phoneNumberId,
      customerPhone: to
    });

    // Get the stored message textBody (contains actual template content)
    const queuedMsg = await whatsappMessageModel.findById(messageId, "textBody");
    const displayText = queuedMsg?.textBody || `Template: ${templateName}`;
    const previewText = displayText.substring(0, 50);

    if (!conversation) {
      conversation = await whatsappConversationModel.create({
        businessId: resolvedBusinessId,
        wabaId: account.wabaId,
        phoneNumberId: account.phoneNumberId,
        customerPhone: to,
        customerName: "Unknown",
        lastMessage: previewText,
        lastMessageAt: new Date(),
        unreadCount: 0,
        status: "OPEN"
      });
    } else {
      conversation.businessId = resolvedBusinessId; // Transfer to current sender
      conversation.lastMessage = previewText;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    const updatedMessage = await whatsappMessageModel.findOneAndUpdate(
      { _id: messageId, status: "QUEUED" },
      {
        conversationId: conversation._id,
        status: "SENT",
        metaMessageId: wamid || null,
        sentAt: new Date(),
      },
      { new: true }
    );

    if (!updatedMessage) {
      return;
    }

    await whatsappCampaignModel.findByIdAndUpdate(campaignId, {
      $inc: { "stats.sent": 1, "stats.queued": -1 },
      $set: { status: "RUNNING" },
    });

    // Check if campaign is now fully processed (queued count = 0)
    const updatedCampaign = await whatsappCampaignModel.findById(campaignId, "stats status");
    if (updatedCampaign && updatedCampaign.stats.queued <= 0 && updatedCampaign.status !== "PAUSED") {
      await whatsappCampaignModel.findByIdAndUpdate(campaignId, { status: "COMPLETED" });
    }

    // Emit real-time update via Socket.IO
    if (global.io) {
      global.io
        .to(`campaign:${campaignId}`)
        .emit("campaignStatsUpdate", { campaignId });
        
      if (resolvedBusinessId) {
        global.io
          .to(`business:${resolvedBusinessId}`)
          .emit("newWhatsAppMessage", {
            conversationId: conversation._id,
            customerPhone: to,
            textBody: previewText
          });
      }
    }
  } catch (error) {
    const errData = error?.response?.data?.error || {};
    const maxAttempts = job?.opts?.attempts || 1;
    const isFinalAttempt = (job.attemptsMade + 1) >= maxAttempts;

    // Only mark the message failed when retries are exhausted.
    const currentMsg = await whatsappMessageModel.findById(messageId, "status");
    const shouldMarkFailed =
      isFinalAttempt &&
      currentMsg &&
      (currentMsg.status === "QUEUED" || currentMsg.status === "SENT");

    if (shouldMarkFailed) {
      await whatsappMessageModel.findByIdAndUpdate(messageId, {
        status: "FAILED",
        errorCode: String(error?.code || errData?.code || "UNKNOWN"),
        errorMessage: error?.message || errData?.message || "Send failed",
        failedAt: new Date(),
      });

      await whatsappCampaignModel.findByIdAndUpdate(campaignId, {
        $inc: { "stats.failed": 1, "stats.queued": -1 },
      });

      // Check if campaign is fully processed even after failure
      const updatedCampaign = await whatsappCampaignModel.findById(campaignId, "stats status");
      if (updatedCampaign && updatedCampaign.stats.queued <= 0 && updatedCampaign.status !== "PAUSED") {
        await whatsappCampaignModel.findByIdAndUpdate(campaignId, { status: "COMPLETED" });
      }
    }

    // Emit real-time update
    if (global.io) {
      global.io
        .to(`campaign:${campaignId}`)
        .emit("campaignStatsUpdate", { campaignId });
    }

    throw error; // Re-throw so BullMQ handles retries
  }
};

const startWhatsAppWorker = () => {
  worker = new Worker("whatsapp-messages", processJob, {
    connection: createRedisConnection(),
    concurrency: 5, // Process 5 messages in parallel — stays well within Meta's rate limits
  });

  worker.on("completed", (job) => {
    console.log(`[WhatsApp Worker] Job ${job.id} completed — to: ${job.data.to}`);
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[WhatsApp Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`
    );
  });

  worker.on("error", (err) => {
    console.error("[WhatsApp Worker] Worker error:", err.message);
  });

  console.log("[WhatsApp Worker] Started — concurrency: 5");
  return worker;
};

const stopWhatsAppWorker = async () => {
  if (worker) {
    await worker.close();
    console.log("[WhatsApp Worker] Stopped");
  }
};

module.exports = { startWhatsAppWorker, stopWhatsAppWorker };
