const whatsappChatbotConfigModel = require("../models/whatsappChatbotConfigModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const businessModel = require("../models/businessModel");

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
    enabled: obj.enabled !== false,
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

const defaultConfigPayload = (userId, businessId, account) => ({
  userId,
  businessId: businessId || undefined,
  enabled: true,
  businessName: account?.businessName || account?.verifiedName || "",
  greeting: "Hi! Thanks for messaging us. How can we help you today?",
  fallbackMessage: "Thanks for your message. A team member will get back to you shortly.",
  faqs: [],
  handoffKeywords: [...DEFAULT_HANDOFF],
  systemPrompt: "",
});

exports.getBotConfig = async (req, res) => {
  try {
    const userId = req.user._id;
    let config = await whatsappChatbotConfigModel.findOne({ userId });
    if (!config) {
      const account = await whatsappAccountModel.findOne({ userId, status: "CONNECTED" });
      const business = await businessModel.findOne({ userId }).select("_id");
      config = await whatsappChatbotConfigModel.create(
        defaultConfigPayload(userId, business?._id, account)
      );
    }
    return res.status(200).json({ success: true, data: toPublic(config) });
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
    if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
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
        ...defaultConfigPayload(userId, business?._id, account),
        ...updates,
      });
    } else {
      Object.assign(config, updates);
      await config.save();
    }

    return res.status(200).json({ success: true, data: toPublic(config) });
  } catch (error) {
    console.error("[BotConfig] updateBotConfig:", error);
    return res.status(500).json({ success: false, message: error.message || "Could not save chatbot settings" });
  }
};
