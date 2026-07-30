const whatsappCampaignService = require("../services/whatsappCampaignService");
const whatsappTemplateService = require("../services/whatsappTemplateService");
const whatsappCampaignModel = require("../models/whatsappCampaignModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");

exports.createCampaign = async (req, res) => {
  try {
    const { name, templateId, businessId, variableMapping } = req.body;

    if (!name || !templateId) {
      return res.status(400).json({ success: false, message: "name and templateId are required" });
    }

    let contacts = [];
    let errors = [];

    if (req.file) {
      // Handle Excel file upload
      let fileBuffer;
      if (req.file.buffer) {
        fileBuffer = req.file.buffer;
      } else {
        const axios = require("axios");
        const response = await axios.get(req.file.location, { responseType: "arraybuffer" });
        fileBuffer = Buffer.from(response.data);
      }
      const parsed = whatsappCampaignService.parseContactsExcel(fileBuffer);
      contacts = parsed.contacts;
      errors = parsed.errors;
    } else if (req.body.phoneNumbers) {
      // Handle direct phone numbers (Manual/Contacts)
      const parsed = whatsappCampaignService.parsePhoneNumbers(req.body.phoneNumbers);
      contacts = parsed.contacts;
      errors = parsed.errors;
    } else {
      return res.status(400).json({ success: false, message: "Contacts file or phoneNumbers list is required" });
    }

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid contacts found",
        errors,
      });
    }

    const connectedAccount = await whatsappAccountModel.findOne({
      userId: req.user._id,
      status: "CONNECTED",
    }).select("_id phoneNumber phoneNumberId wabaId");

    if (!connectedAccount?.phoneNumberId || !connectedAccount?.wabaId) {
      return res.status(403).json({
        success: false,
        message: "WhatsApp account not connected. Please connect and verify your Meta WhatsApp number first.",
      });
    }

    const template = await whatsappTemplateService.getTemplateById(templateId);
    if (!template) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    if (
      req.user.userType !== "ADMIN" &&
      template.createdBy &&
      template.createdBy.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to use this template",
      });
    }

    if (template.status !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: `Template is ${template.status}. Only APPROVED templates can be used.`,
      });
    }

    let parsedVariableMapping = {};
    if (variableMapping) {
      try {
        parsedVariableMapping =
          typeof variableMapping === "string" ? JSON.parse(variableMapping) : variableMapping;
      } catch {
        parsedVariableMapping = {};
      }
    }

    // --- Subscription & Limit Enforcement (Bypass for ADMIN) ---
    if (req.user.userType !== "ADMIN") {
      const WhatsAppSubscription = require("../models/whatsappSubscriptionModel");
      const activeSub = await WhatsAppSubscription.findOne({
        userId: req.user._id,
        status: "ACTIVE",
        endDate: { $gt: new Date() }
      }).populate("planId");

      if (!activeSub || !activeSub.planId) {
        return res.status(403).json({
          success: false,
          message: "No active WhatsApp plan. Please purchase a plan to send campaigns."
        });
      }

      const plan = activeSub.planId;

      // 1. Check Contact Limit (per campaign)
      if (contacts.length > plan.contactLimit) {
        return res.status(403).json({
          success: false,
          message: `Plan limit exceeded: Your current plan allows up to ${plan.contactLimit} contacts per campaign.`
        });
      }

      // 2. Check Campaign Limit (per billing cycle)
      const campaignsThisCycle = await whatsappCampaignModel.countDocuments({
        createdBy: req.user._id,
        createdAt: { $gte: activeSub.startDate, $lte: activeSub.endDate }
      });

      if (campaignsThisCycle >= plan.campaignLimit) {
        return res.status(403).json({
          success: false,
          message: `Plan limit exceeded: You have reached your limit of ${plan.campaignLimit} campaigns for this billing cycle.`
        });
      }
    }
    // ----------------------------------------

    // Create campaign record
    const campaign = await whatsappCampaignService.createCampaign({
      name,
      templateId,
      businessId: businessId || null,
      createdBy: req.user._id,
      variableMapping: parsedVariableMapping,
      totalContacts: contacts.length,
      status: "QUEUED",
      "stats.queued": contacts.length,
    });

    // Enqueue all messages
    const enqueuedCount = await whatsappCampaignService.enqueueCampaignMessages(
      campaign,
      contacts,
      template
    );

    return res.status(201).json({
      success: true,
      message: `Campaign created — ${enqueuedCount} messages queued`,
      data: campaign,
      totalContacts: enqueuedCount,
      skipped: contacts.length - enqueuedCount,
      parseErrors: errors,
    });
  } catch (error) {
    console.error("[Campaign] createCampaign error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllCampaigns = async (req, res) => {
  try {
    const { page = 1, status = "", businessId, search = "" } = req.query;
    const result = await whatsappCampaignService.getAllCampaigns({
      page: parseInt(page),
      status,
      businessId,
      createdBy: req.user.userType === "ADMIN" ? null : req.user._id,
      search,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCampaignById = async (req, res) => {
  try {
    const campaign = await whatsappCampaignService.getCampaignById(req.params.campaignId, {
      createdBy: req.user._id,
      isAdmin: req.user.userType === "ADMIN",
    });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
    return res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCampaignReport = async (req, res) => {
  try {
    const { campaignId, page = 1 } = req.query;
    if (!campaignId) {
      return res.status(400).json({ success: false, message: "campaignId is required" });
    }
    const report = await whatsappCampaignService.getCampaignReport(campaignId, parseInt(page), {
      createdBy: req.user._id,
      isAdmin: req.user.userType === "ADMIN",
    });
    if (!report) return res.status(404).json({ success: false, message: "Campaign not found" });
    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWhatsAppStats = async (req, res) => {
  try {
    const { businessId } = req.query;
    const [stats, account] = await Promise.all([
      whatsappCampaignService.getOverallStats({
        businessId,
        createdBy: req.user._id,
        isAdmin: req.user.userType === "ADMIN",
      }),
      whatsappAccountModel.findOne({ userId: req.user._id }).select("phoneNumber status"),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        ...stats,
        whatsappNumber: account?.phoneNumber || null,
        accountStatus: account?.status || "DISCONNECTED",
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.pauseCampaign = async (req, res) => {
  try {
    const campaign = await whatsappCampaignModel.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to pause this campaign" });
    }

    campaign.status = "PAUSED";
    await campaign.save();

    return res.status(200).json({ success: true, message: "Campaign paused", data: campaign });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.resumeCampaign = async (req, res) => {
  try {
    const campaign = await whatsappCampaignModel.findById(req.params.campaignId);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    if (campaign.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized to resume this campaign" });
    }

    campaign.status = "QUEUED";
    await campaign.save();

    const requeuedCount = await whatsappCampaignService.requeueQueuedMessages(campaign._id);

    return res.status(200).json({
      success: true,
      message: `Campaign resumed${requeuedCount ? ` — ${requeuedCount} queued message(s) restored` : ""}`,
      data: campaign,
      requeuedCount,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    await whatsappCampaignService.deleteCampaign(req.params.campaignId, req.user._id);
    return res.status(200).json({ success: true, message: "Campaign deleted successfully" });
  } catch (error) {
    console.error("[Campaign] deleteCampaign error:", error.message);
    const status = error.message.includes("not found") ? 404 : error.message.includes("authorized") ? 403 : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};
