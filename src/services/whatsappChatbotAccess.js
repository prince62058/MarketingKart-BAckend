const ChatbotPlan = require("../models/whatsappChatbotPlanModel");
const ChatbotSubscription = require("../models/whatsappChatbotSubscriptionModel");
const ChatbotSettings = require("../models/whatsappChatbotSettingsModel");
const User = require("../models/userModel");
const WhatsAppTransaction = require("../models/whatsappTransactionModel");
const { PLANS, EXTRA_REPLY_RUPEES } = require("./whatsappChatbotPlanCatalog");

async function ensurePlans() {
  for (const plan of PLANS) {
    const existing = await ChatbotPlan.findOne({ code: plan.code });
    if (existing) {
      if (!String(existing.subtitle || "").trim() && plan.subtitle) {
        existing.subtitle = plan.subtitle;
        await existing.save();
      }
      continue;
    }
    await ChatbotPlan.create({ ...plan, disable: false });
  }
}

const DEFAULT_CONTENT = {
  greeting: "Hi! Welcome to MarketingKart. Ask us about ads, packages, or WhatsApp marketing.",
  fallbackMessage: "Thanks! Our team will reply shortly.",
  systemPrompt: "You help with Meta ads and WhatsApp marketing on MarketingKart. Be concise and reply in English.",
  handoffKeywords: ["human", "agent", "talk to a person", "speak to someone", "customer care"],
  faqs: [
    {
      question: "What are your hours?",
      answer: "We are available Monday to Saturday, 10am to 7pm.",
      keywords: ["hours", "timing", "open", "time"],
    },
    {
      question: "Pricing / packages?",
      answer: "Launch ₹1499 (3 days), Scale ₹2000 (3 days), Pro Ads ₹3599 (5 days), Dominate ₹5999 (7 days).",
      keywords: ["price", "pricing", "package", "cost", "plan"],
    },
    {
      question: "How to create an ad?",
      answer: "Open Create Ad in the app, choose a package, set your creatives and target area, then pay.",
      keywords: ["create", "ad", "start"],
    },
  ],
};

function cleanFaqs(faqs) {
  if (!Array.isArray(faqs)) return [];
  return faqs
    .slice(0, 50)
    .map((faq) => ({
      question: String(faq?.question || "").trim().slice(0, 300),
      answer: String(faq?.answer || "").trim().slice(0, 2000),
      keywords: Array.isArray(faq?.keywords)
        ? faq.keywords.map((word) => String(word || "").trim().toLowerCase()).filter(Boolean).slice(0, 20)
        : String(faq?.keywords || "")
            .split(",")
            .map((word) => word.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 20),
    }))
    .filter((faq) => faq.question && faq.answer);
}

function presentContent(settings) {
  return {
    greeting: settings?.greeting || "",
    fallbackMessage: settings?.fallbackMessage || "",
    systemPrompt: settings?.systemPrompt || "",
    handoffKeywords: Array.isArray(settings?.handoffKeywords) ? settings.handoffKeywords : [],
    faqs: Array.isArray(settings?.faqs) ? settings.faqs : [],
  };
}

async function content() {
  let settings = await ChatbotSettings.findOne({ key: "chatbot" });
  if (!settings) {
    settings = await ChatbotSettings.create({
      key: "chatbot",
      extraReplyRupees: EXTRA_REPLY_RUPEES,
      ...DEFAULT_CONTENT,
    });
    return presentContent(settings);
  }
  const untouched = !String(settings.greeting || "").trim() && !(settings.faqs || []).length;
  if (untouched) {
    settings.greeting = DEFAULT_CONTENT.greeting;
    settings.fallbackMessage = DEFAULT_CONTENT.fallbackMessage;
    settings.systemPrompt = DEFAULT_CONTENT.systemPrompt;
    settings.handoffKeywords = DEFAULT_CONTENT.handoffKeywords;
    settings.faqs = DEFAULT_CONTENT.faqs;
    await settings.save();
  }
  return presentContent(settings);
}

async function saveContent(body) {
  const current = await ChatbotSettings.findOne({ key: "chatbot" });
  const base = current || new ChatbotSettings({ key: "chatbot", extraReplyRupees: EXTRA_REPLY_RUPEES });
  if (body.greeting !== undefined) base.greeting = String(body.greeting || "").trim().slice(0, 500);
  if (body.fallbackMessage !== undefined) base.fallbackMessage = String(body.fallbackMessage || "").trim().slice(0, 500);
  if (body.systemPrompt !== undefined) base.systemPrompt = String(body.systemPrompt || "").trim().slice(0, 1000);
  if (body.handoffKeywords !== undefined) {
    const words = Array.isArray(body.handoffKeywords)
      ? body.handoffKeywords
      : String(body.handoffKeywords || "").split(",");
    base.handoffKeywords = words.map((word) => String(word || "").trim().toLowerCase()).filter(Boolean).slice(0, 40);
  }
  if (body.faqs !== undefined) base.faqs = cleanFaqs(body.faqs);
  await base.save();
  return presentContent(base);
}

async function extraReplyRupees() {
  let settings = await ChatbotSettings.findOne({ key: "chatbot" }).lean();
  if (!settings) {
    settings = await ChatbotSettings.create({ key: "chatbot", extraReplyRupees: EXTRA_REPLY_RUPEES });
  }
  const amount = Number(settings.extraReplyRupees);
  if (!Number.isFinite(amount) || amount <= 0) return EXTRA_REPLY_RUPEES;
  return Number(amount.toFixed(2));
}

async function saveExtraReplyRupees(amount) {
  const rupees = Number(Number(amount).toFixed(2));
  if (!Number.isFinite(rupees) || rupees < 0.2 || rupees > 100) {
    throw new Error("Extra reply price must be between ₹0.20 and ₹100.");
  }
  const settings = await ChatbotSettings.findOneAndUpdate(
    { key: "chatbot" },
    { $set: { extraReplyRupees: rupees }, $setOnInsert: { key: "chatbot" } },
    { new: true, upsert: true }
  );
  return Number(settings.extraReplyRupees);
}

function activeFilter(userId) {
  return { userId, status: "ACTIVE", endDate: { $gt: new Date() } };
}

async function findActive(userId) {
  if (!userId) return null;
  return ChatbotSubscription.findOne(activeFilter(userId)).populate("planId").sort({ createdAt: -1 });
}

async function allowsBot(userId) {
  return Boolean(await findActive(userId));
}

async function presentAccess(sub) {
  const extra = await extraReplyRupees();
  if (!sub) {
    return {
      active: false,
      repliesLeft: 0,
      extraReplyRupees: extra,
      planTitle: null,
      planId: null,
      expiresAt: null,
    };
  }
  const plan = sub.planId && sub.planId.title ? sub.planId : null;
  return {
    active: true,
    repliesLeft: Math.max(0, Math.floor(sub.replyCredits || 0)),
    extraReplyRupees: extra,
    planTitle: plan ? plan.title : "Chatbot",
    planId: plan ? String(plan._id) : String(sub.planId || ""),
    expiresAt: sub.endDate,
  };
}

/**
 * Spend one included reply, or the admin's extra-reply price from the WhatsApp wallet.
 * No active chatbot plan means the bot must stay silent.
 */
async function consumeReply(userId) {
  const taken = await ChatbotSubscription.findOneAndUpdate(
    { ...activeFilter(userId), replyCredits: { $gte: 1 } },
    { $inc: { replyCredits: -1 } },
    { new: true }
  );
  if (taken) {
    return { ok: true, source: "credit", repliesLeft: taken.replyCredits };
  }

  const active = await ChatbotSubscription.findOne(activeFilter(userId)).select("_id").lean();
  if (!active) return { ok: false, reason: "no_plan" };

  const price = await extraReplyRupees();
  const paid = await User.findOneAndUpdate(
    { _id: userId, whatsappWallet: { $gte: price } },
    { $inc: { whatsappWallet: -price } },
    { new: true }
  );
  if (!paid) return { ok: false, reason: "wallet" };

  const newBalance = Number(paid.whatsappWallet || 0);
  await WhatsAppTransaction.create({
    type: "DEBIT",
    amount: price,
    userId,
    transactionId: `wa_bot_${Date.now()}`,
    mode: "PLAN_PURCHASE",
    description: "Chatbot extra AI reply",
    previousBalance: Number((newBalance + price).toFixed(2)),
    newBalance: Number(newBalance.toFixed(2)),
  });
  return { ok: true, source: "wallet", repliesLeft: 0, amount: price };
}

async function refundReply(userId, source, amount) {
  if (!userId || !source) return;
  if (source === "credit") {
    await ChatbotSubscription.updateOne(activeFilter(userId), { $inc: { replyCredits: 1 } });
    return;
  }
  if (source === "wallet") {
    const rupees = Number(amount) > 0 ? Number(Number(amount).toFixed(2)) : await extraReplyRupees();
    await User.updateOne({ _id: userId }, { $inc: { whatsappWallet: rupees } });
  }
}

module.exports = {
  EXTRA_REPLY_RUPEES,
  ensurePlans,
  content,
  saveContent,
  extraReplyRupees,
  saveExtraReplyRupees,
  findActive,
  allowsBot,
  presentAccess,
  consumeReply,
  refundReply,
};
