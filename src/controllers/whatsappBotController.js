const mongoose = require("mongoose");
const whatsappChatbotConfigModel = require("../models/whatsappChatbotConfigModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const businessModel = require("../models/businessModel");
const User = require("../models/userModel");
const WhatsAppSubscription = require("../models/whatsappSubscriptionModel");
const WhatsAppTransaction = require("../models/whatsappTransactionModel");
const ChatbotPlan = require("../models/whatsappChatbotPlanModel");
const ChatbotSubscription = require("../models/whatsappChatbotSubscriptionModel");
const chatbotAccess = require("../services/whatsappChatbotAccess");
const { whatsappPlanInvoice } = require("../services/serviceInvoiceService");
const { assertPlanEarns } = require("../services/whatsappChatbotPlanCatalog");

const isAdminUser = (user) => user?.userType === "ADMIN" || user?.role === "ADMIN" || user?.userType === "STAFF";

const DEFAULT_HANDOFF = whatsappChatbotConfigModel.DEFAULT_HANDOFF || [
  "human",
  "agent",
  "talk to person",
  "speak to someone",
  "talk to human",
  "customer care",
  "insan",
  "agent se baat",
];

const sanitizeFaqs = (faqs) => {
  if (!Array.isArray(faqs)) return [];
  return faqs
    .slice(0, 50)
    .map((f) => ({
      question: String(f?.question || "").trim().slice(0, 300),
      answer: String(f?.answer || "").trim().slice(0, 2000),
      keywords: Array.isArray(f?.keywords)
        ? f.keywords.map((k) => String(k || "").trim().toLowerCase()).filter(Boolean).slice(0, 20)
        : [],
    }))
    .filter((f) => f.question && f.answer);
};

const sanitizeKeywords = (keywords) => {
  if (!Array.isArray(keywords)) return [...DEFAULT_HANDOFF];
  const cleaned = keywords
    .map((k) => String(k || "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40);
  return cleaned.length ? cleaned : [...DEFAULT_HANDOFF];
};

const toPublic = (doc) => {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  return {
    _id: String(obj._id),
    userId: String(obj.userId),
    businessId: obj.businessId ? String(obj.businessId) : null,
    enabled: obj.enabled === true,
    businessName: obj.businessName || "",
    greeting: obj.greeting || "",
    fallbackMessage: obj.fallbackMessage || "",
    faqs: Array.isArray(obj.faqs) ? obj.faqs : [],
    handoffKeywords: Array.isArray(obj.handoffKeywords) && obj.handoffKeywords.length
      ? obj.handoffKeywords
      : [...DEFAULT_HANDOFF],
    systemPrompt: obj.systemPrompt || "",
    updatedAt: obj.updatedAt,
  };
};

const defaultConfigPayload = async (userId, businessId, account) => {
  const platform = await chatbotAccess.content();
  return {
    userId,
    businessId: businessId || undefined,
    enabled: false,
    businessName: account?.businessName || account?.verifiedName || "",
    greeting: platform.greeting || "Hi! Thanks for messaging us. How can we help you today?",
    fallbackMessage: platform.fallbackMessage || "Thanks for your message. A team member will get back to you shortly.",
    faqs: platform.faqs || [],
    handoffKeywords: platform.handoffKeywords?.length ? platform.handoffKeywords : [...DEFAULT_HANDOFF],
    systemPrompt: platform.systemPrompt || "",
  };
};

exports.getBotConfig = async (req, res) => {
  try {
    const userId = req.user._id;
    let config = await whatsappChatbotConfigModel.findOne({ userId });
    if (!config) {
      const account = await whatsappAccountModel.findOne({ userId, status: "CONNECTED" });
      const business = await businessModel.findOne({ userId }).select("_id");
      config = await whatsappChatbotConfigModel.create(
        await defaultConfigPayload(userId, business?._id, account)
      );
    }
    const access = await chatbotAccess.presentAccess(await chatbotAccess.findActive(userId));
    return res.status(200).json({ success: true, data: { ...toPublic(config), access } });
  } catch (error) {
    console.error("[BotConfig] getBotConfig:", error);
    return res.status(500).json({ success: false, message: error.message || "Could not load chatbot settings" });
  }
};

exports.updateBotConfig = async (req, res) => {
  try {
    const userId = req.user._id;
    const body = req.body || {};

    const updates = {};
    if (typeof body.enabled === "boolean") {
      if (body.enabled) {
        const access = await chatbotAccess.findActive(userId);
        if (!access) {
          return res.status(403).json({
            success: false,
            message: "Buy a chatbot plan to turn the AI agent on.",
          });
        }
      }
      updates.enabled = body.enabled;
    }
    if (typeof body.businessName === "string") updates.businessName = body.businessName.trim().slice(0, 120);
    if (typeof body.greeting === "string") updates.greeting = body.greeting.trim().slice(0, 500);
    if (typeof body.fallbackMessage === "string") updates.fallbackMessage = body.fallbackMessage.trim().slice(0, 500);
    if (typeof body.systemPrompt === "string") updates.systemPrompt = body.systemPrompt.trim().slice(0, 1000);
    if (body.faqs !== undefined) updates.faqs = sanitizeFaqs(body.faqs);
    if (body.handoffKeywords !== undefined) updates.handoffKeywords = sanitizeKeywords(body.handoffKeywords);

    let config = await whatsappChatbotConfigModel.findOne({ userId });
    if (!config) {
      const account = await whatsappAccountModel.findOne({ userId, status: "CONNECTED" });
      const business = await businessModel.findOne({ userId }).select("_id");
      config = await whatsappChatbotConfigModel.create({
        ...(await defaultConfigPayload(userId, business?._id, account)),
        ...updates,
      });
    } else {
      Object.assign(config, updates);
      await config.save();
    }

    const access = await chatbotAccess.presentAccess(await chatbotAccess.findActive(userId));
    return res.status(200).json({ success: true, data: { ...toPublic(config), access } });
  } catch (error) {
    console.error("[BotConfig] updateBotConfig:", error);
    return res.status(500).json({ success: false, message: error.message || "Could not save chatbot settings" });
  }
};

function planCode(title) {
  const slug = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  const base = slug ? (slug.startsWith("chatbot") ? slug : `chatbot_${slug}`) : "chatbot";
  return `${base}_${Date.now().toString(36)}`;
}

function cleanPlanInput(body) {
  const features = Array.isArray(body.features)
    ? body.features
    : String(body.features || "").split(",");
  return {
    title: String(body.title || "").trim().slice(0, 80),
    price: Number(body.price),
    duration: Math.max(1, Math.floor(Number(body.duration) || 30)),
    replyCredits: Math.floor(Number(body.replyCredits) || 0),
    features: features.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12),
    subtitle: String(body.subtitle || "").trim().slice(0, 80),
    badge: String(body.badge || "").trim().slice(0, 24) || null,
    color: String(body.color || "#059669").trim().slice(0, 20),
    sortOrder: Math.floor(Number(body.sortOrder) || 0),
  };
}

exports.getChatbotPlans = async (req, res) => {
  try {
    await chatbotAccess.ensurePlans();
    const includeHidden = req.query.all === "true" && isAdminUser(req.user);
    const filter = includeHidden ? {} : { disable: false, price: { $gt: 0 } };
    const plans = await ChatbotPlan.find(filter).sort({ sortOrder: 1, price: 1 }).lean();
    const extraReplyRupees = await chatbotAccess.extraReplyRupees();
    return res.status(200).json({
      success: true,
      extraReplyRupees,
      data: plans.map((plan) => ({ ...plan, extraReplyRupees })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Could not load chatbot plans" });
  }
};

exports.getChatbotSubscription = async (req, res) => {
  try {
    const sub = await chatbotAccess.findActive(req.user._id);
    return res.status(200).json({ success: true, data: await chatbotAccess.presentAccess(sub) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Could not load chatbot plan" });
  }
};

exports.createChatbotPlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can create chatbot plans" });
    }
    const input = cleanPlanInput(req.body || {});
    if (!input.title) return res.status(400).json({ success: false, message: "Plan title is required" });
    assertPlanEarns(input);
    const plan = await ChatbotPlan.create({ ...input, code: planCode(input.title), disable: false });
    return res.status(201).json({ success: true, data: plan });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateChatbotPlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can update chatbot plans" });
    }
    const current = await ChatbotPlan.findById(req.params.planId);
    if (!current) return res.status(404).json({ success: false, message: "Plan not found" });
    const input = cleanPlanInput({ ...current.toObject(), ...req.body });
    if (!input.title) return res.status(400).json({ success: false, message: "Plan title is required" });
    assertPlanEarns(input);
    Object.assign(current, input);
    await current.save();
    return res.status(200).json({ success: true, data: current });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.toggleChatbotPlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can change chatbot plans" });
    }
    const plan = await ChatbotPlan.findById(req.params.planId);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    plan.disable = !plan.disable;
    await plan.save();
    return res.status(200).json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getChatbotSettings = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can view chatbot pricing" });
    }
    const platform = await chatbotAccess.content();
    return res.status(200).json({
      success: true,
      data: { extraReplyRupees: await chatbotAccess.extraReplyRupees(), ...platform },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateChatbotSettings = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can change chatbot pricing" });
    }
    const body = req.body || {};
    let extraReplyRupees = await chatbotAccess.extraReplyRupees();
    if (body.extraReplyRupees !== undefined) {
      extraReplyRupees = await chatbotAccess.saveExtraReplyRupees(body.extraReplyRupees);
    }
    const hasContent = ["greeting", "fallbackMessage", "systemPrompt", "handoffKeywords", "faqs"].some(
      (key) => body[key] !== undefined
    );
    const platform = hasContent ? await chatbotAccess.saveContent(body) : await chatbotAccess.content();
    return res.status(200).json({ success: true, data: { extraReplyRupees, ...platform } });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.purchaseChatbotPlan = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await chatbotAccess.ensurePlans();
    const userId = req.user._id;
    const plan = await ChatbotPlan.findById(req.body.planId);
    if (!plan || plan.disable) throw new Error("Plan not found or disabled");
    if (!(plan.price > 0) || !(plan.replyCredits > 0)) throw new Error("This chatbot plan is not available");

    const messagePlan = await WhatsAppSubscription.findOne({
      userId,
      status: "ACTIVE",
      endDate: { $gt: new Date() },
    }).lean();
    if (!messagePlan) {
      throw new Error("Buy a WhatsApp plan first. The chatbot is an add-on on that plan.");
    }

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");
    const prevBal = parseFloat(user.whatsappWallet || 0);
    if (prevBal < plan.price) throw new Error("Insufficient wallet balance");
    const newBal = parseFloat((prevBal - plan.price).toFixed(2));

    const [txn] = await WhatsAppTransaction.create(
      [{
        type: "DEBIT",
        amount: plan.price,
        userId,
        transactionId: `wa_chatbot_${Date.now()}`,
        mode: "PLAN_PURCHASE",
        description: `Chatbot plan purchased: ${plan.title}`,
        previousBalance: prevBal,
        newBalance: newBal,
      }],
      { session }
    );

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (plan.duration || 30));
    await ChatbotSubscription.updateMany(
      { userId, status: "ACTIVE" },
      { status: "EXPIRED" },
      { session }
    );
    await ChatbotSubscription.create(
      [{
        userId,
        planId: plan._id,
        status: "ACTIVE",
        startDate: new Date(),
        endDate,
        transactionId: txn._id,
        replyCredits: plan.replyCredits,
        replyAllowance: plan.replyCredits,
      }],
      { session }
    );

    user.whatsappWallet = newBal;
    await user.save({ session });
    await session.commitTransaction();

    whatsappPlanInvoice({
      userId,
      planTitle: `Chatbot ${plan.title}`,
      amount: plan.price,
      days: plan.duration || 30,
      replies: plan.replyCredits,
      transactionId: txn._id,
      planId: plan._id,
    }).catch((invoiceErr) => console.error("Chatbot plan invoice failed:", invoiceErr.message));

    return res.status(200).json({
      success: true,
      message: `${plan.title} is now active.`,
      data: {
        walletBalance: newBal,
        plan: plan.title,
        expiresAt: endDate,
        amount: plan.price,
        replies: plan.replyCredits,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};
