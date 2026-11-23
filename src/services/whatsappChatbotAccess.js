const ChatbotPlan = require("../models/whatsappChatbotPlanModel");
const ChatbotSubscription = require("../models/whatsappChatbotSubscriptionModel");
const ChatbotSettings = require("../models/whatsappChatbotSettingsModel");
const User = require("../models/userModel");
const WhatsAppTransaction = require("../models/whatsappTransactionModel");
const { PLANS, EXTRA_REPLY_RUPEES } = require("./whatsappChatbotPlanCatalog");

async function ensurePlans() {
  for (const plan of PLANS) {
    const existing = await ChatbotPlan.findOne({ code: plan.code }).select("_id").lean();
    if (existing) continue;
    await ChatbotPlan.create({ ...plan, disable: false });
  }
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
  extraReplyRupees,
  saveExtraReplyRupees,
  findActive,
  presentAccess,
  consumeReply,
  refundReply,
};
