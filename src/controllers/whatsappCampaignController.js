const whatsappCampaignService = require("../services/whatsappCampaignService");
const whatsappBilling = require("../services/whatsappBillingService");
const whatsappTemplateService = require("../services/whatsappTemplateService");
const whatsappCampaignModel = require("../models/whatsappCampaignModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const OpenAI = require("openai");

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

exports.quoteCampaign = async (req, res) => {
  try {
    const template = await whatsappTemplateService.getTemplateById(req.query.templateId);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    const estimate = await whatsappBilling.quote({
      userId: req.user._id,
      category: whatsappBilling.categoryOf(template),
      count: req.query.count,
    });
    return res.status(200).json({ success: true, data: estimate });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createCampaign = async (req, res) => {
  let hold = null;
  let campaignStarted = false;
  try {
    const {
      name,
      templateId,
      businessId,
      variableMapping,
      scheduledAt,
      sendRatePerMinute,
    } = req.body;

    if (!name || !templateId) {
      return res.status(400).json({ success: false, message: "name and templateId are required" });
    }

    // "Send later" is only honoured if it is a real future time — a past or
    // unparseable value sends now rather than silently never sending.
    let startAt = null;
    if (scheduledAt) {
      const parsedDate = new Date(scheduledAt);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "scheduledAt is not a valid date",
        });
      }
      if (parsedDate.getTime() > Date.now()) startAt = parsedDate;
    }

    let ratePerMinute = Math.min(
      Math.max(parseInt(sendRatePerMinute, 10) || 60, 1),
      600,
    );

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
    }).select("_id phoneNumber phoneNumberId wabaId verifiedName");

    if (!connectedAccount?.phoneNumberId || !connectedAccount?.wabaId) {
      return res.status(403).json({
        success: false,
        message: "WhatsApp account not connected. Please connect and verify your Meta WhatsApp number first.",
      });
    }

    // Meta developer "Test Number" can only message up to 5 pre-approved recipients
    // (error 131030). Block campaigns until a real business number is connected.
    const isMetaSandboxTestNumber = (() => {
      const name = String(connectedAccount.verifiedName || "").trim().toLowerCase();
      const phone = String(connectedAccount.phoneNumber || "").replace(/\s+/g, "");
      return (
        name === "test number" ||
        /\+?1555-?664/.test(phone) ||
        connectedAccount.phoneNumberId === "1281600561703344"
      );
    })();

    if (isMetaSandboxTestNumber) {
      return res.status(400).json({
        success: false,
        code: "META_TEST_NUMBER",
        message:
          "Your WhatsApp is connected to Meta's Test Number. It can only message numbers added in Meta Developer Console → WhatsApp → API Setup → Manage phone number list. Connect your real business WhatsApp number to send campaigns.",
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

    const headerFormat = String(template.headerType || "").toUpperCase();
    if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat) && !/^https:\/\//i.test(String(template.headerMediaUrl || ""))) {
      return res.status(400).json({
        success: false,
        message: "This template needs a public https photo, video or file before it can be sent.",
      });
    }

    if (template.status !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: `Template is ${template.status}. Only APPROVED templates can be used.`,
      });
    }

    // A one-time passcode carries a code made for one person; it is never a campaign message.
    if (template.category === "AUTHENTICATION" || template.templateType === "OTP") {
      return res.status(400).json({
        success: false,
        message: "One-time passcode templates cannot be sent as a campaign.",
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

    // Super-admin limits for this customer: campaign size and send speed.
    const caps = await require("../services/whatsappControls").limitsFor(req.user._id);
    if (caps.maxCampaignContacts.value && contacts.length > caps.maxCampaignContacts.value) {
      return res.status(403).json({
        success: false,
        message: `Your account can send a campaign to at most ${caps.maxCampaignContacts.value.toLocaleString("en-IN")} contacts. Split the list or contact support.`,
      });
    }
    if (caps.campaignRatePerMinute.value) ratePerMinute = Math.min(ratePerMinute, caps.campaignRatePerMinute.value);

    const billCategory = whatsappBilling.categoryOf(template);
    if (req.user.userType !== "ADMIN") {
      hold = await whatsappBilling.reserveCampaign({
        userId: req.user._id,
        category: billCategory,
        count: contacts.length,
      });
    }

    // Create campaign record
    const campaign = await whatsappCampaignService.createCampaign({
      name,
      templateId,
      businessId: businessId || null,
      createdBy: req.user._id,
      variableMapping: parsedVariableMapping,
      totalContacts: contacts.length,
      status: startAt ? "SCHEDULED" : "QUEUED",
      scheduledAt: startAt,
      sendRatePerMinute: ratePerMinute,
      "stats.queued": contacts.length,
    });
    campaignStarted = true;

    // Enqueue all messages
    const enqueuedCount = await whatsappCampaignService.enqueueCampaignMessages(
      campaign,
      contacts,
      template,
      {
        startAt,
        ratePerMinute,
        billingSources: hold ? hold.sources : [],
        sellPaise: hold ? hold.sellPaise : 0,
        billCategory,
      }
    );

    return res.status(201).json({
      success: true,
      message: startAt
        ? `Campaign scheduled — ${enqueuedCount} messages will start sending at ${startAt.toLocaleString("en-IN")}`
        : `Campaign created — ${enqueuedCount} messages queued`,
      data: campaign,
      totalContacts: enqueuedCount,
      skipped: contacts.length - enqueuedCount,
      parseErrors: errors,
    });
  } catch (error) {
    if (hold && !campaignStarted) {
      await whatsappBilling.releaseHold(hold).catch(() => {});
    }
    console.error("[Campaign] createCampaign error:", error.message);
    return res.status(error.status || 500).json({ success: false, message: error.message });
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

/**
 * Prompt (any language) → autofill campaign name for New Campaign Step 1.
 */
exports.aiFillCampaign = async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ success: false, message: "Prompt is required" });
    }
    if (prompt.length > 500) {
      return res.status(400).json({ success: false, message: "Prompt is too long (max 500 characters)" });
    }

    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({
        success: false,
        message: "AI is not configured. Set OPENAI_API_KEY on the server.",
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      max_tokens: 120,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You name WhatsApp marketing campaigns for MarketingKart.",
            "Write the campaign name in English only, even if the note is in another language.",
            'Return ONLY JSON: { "name": string }',
            "name rules: clear campaign title, max 50 characters, Title Case or natural casing, no hashtags, no emojis, no quotes.",
            "Prefer including festival/offer/audience when present (e.g. Diwali Flash Sale - VIP).",
            "If the prompt is vague, invent a short professional name.",
          ].join("\n"),
        },
        { role: "user", content: prompt },
      ],
    });

    let name = "";
    try {
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
      name = String(parsed.name || "").trim();
    } catch {
      name = "";
    }
    name = name.replace(/["'‘’“”]/g, "").replace(/\s+/g, " ").trim().slice(0, 50);
    if (!name) {
      return res.status(500).json({ success: false, message: "AI could not generate a campaign name" });
    }

    return res.status(200).json({ success: true, data: { name } });
  } catch (error) {
    console.error("[Campaign] aiFillCampaign error:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: "AI fill failed: " + (error.message || "unknown error"),
    });
  }
};
