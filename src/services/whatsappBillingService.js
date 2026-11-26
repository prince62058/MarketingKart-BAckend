const mongoose = require("mongoose");
const Rate = require("../models/whatsappRateModel");
const User = require("../models/userModel");
const Subscription = require("../models/whatsappSubscriptionModel");
const Message = require("../models/whatsappMessageModel");

const CREDIT_FIELD = {
  MARKETING: "marketingCredits",
  UTILITY: "utilityCredits",
  AUTHENTICATION: "authenticationCredits",
  SERVICE: "serviceCredits",
  AUTHENTICATION_INTERNATIONAL: "authenticationCredits",
};

const DEFAULT_RATES = [
  { category: "MARKETING", metaPaise: 86, sellPaise: 110 },
  { category: "UTILITY", metaPaise: 12, sellPaise: 20 },
  { category: "AUTHENTICATION", metaPaise: 12, sellPaise: 25 },
  { category: "SERVICE", metaPaise: 12, sellPaise: 20 },
  { category: "AUTHENTICATION_INTERNATIONAL", metaPaise: 250, sellPaise: 300 },
];

function categoryOf(template) {
  const raw = String(template?.category || "MARKETING").toUpperCase();
  if (CREDIT_FIELD[raw]) return raw;
  return "MARKETING";
}

function allowsMedia(category) {
  return String(category || "").toUpperCase() === "MARKETING";
}

async function ensureRates() {
  const count = await Rate.countDocuments();
  if (count === 0) await Rate.insertMany(DEFAULT_RATES.map((row) => ({ ...row, country: "IN" })));
  return Rate.find().lean();
}

async function rateFor(category) {
  await ensureRates();
  const found = await Rate.findOne({ category }).lean();
  return found || DEFAULT_RATES.find((row) => row.category === category) || DEFAULT_RATES[0];
}

async function quote({ userId, category, count }) {
  const messages = Math.max(0, Math.floor(Number(count) || 0));
  const Account = require("../models/whatsappAccountModel");
  const account = await Account.findOne({ userId }).select("billingMode").lean();
  if (account && account.billingMode === "CUSTOMER") {
    return {
      category,
      messages,
      sellPaise: 0,
      metaPaise: 0,
      credits: 0,
      covered: messages,
      extra: 0,
      walletPaise: 0,
      balancePaise: 0,
      affordable: true,
      customerManaged: true,
    };
  }
  const rate = await rateFor(category);
  const field = CREDIT_FIELD[category] || "marketingCredits";
  const sub = await Subscription.findOne({ userId, status: "ACTIVE", endDate: { $gt: new Date() } }).lean();
  const credits = sub ? Math.max(0, Math.floor(sub[field] || 0)) : 0;
  const covered = Math.min(credits, messages);
  const extra = messages - covered;
  const walletPaise = extra * rate.sellPaise;
  const user = await User.findById(userId).select("whatsappWallet").lean();
  const balancePaise = Math.round(Number(user?.whatsappWallet || 0) * 100);
  return {
    category,
    messages,
    sellPaise: rate.sellPaise,
    metaPaise: rate.metaPaise,
    credits,
    covered,
    extra,
    walletPaise,
    balancePaise,
    affordable: balancePaise >= walletPaise,
  };
}

async function reserveCampaign({ userId, category, count }) {
  const Account = require("../models/whatsappAccountModel");
  const account = await Account.findOne({ userId }).select("billingMode").lean();
  if (account && account.billingMode === "CUSTOMER") {
    return {
      category,
      messages: Math.max(0, Math.floor(Number(count) || 0)),
      sellPaise: 0,
      covered: 0,
      extra: 0,
      walletPaise: 0,
      sources: [],
      userId,
      customerManaged: true,
    };
  }
  const estimate = await quote({ userId, category, count });
  if (!estimate.messages) return { ...estimate, sources: [] };
  if (!estimate.affordable) {
    const need = (estimate.walletPaise / 100).toFixed(2);
    const have = (estimate.balancePaise / 100).toFixed(2);
    const error = new Error(
      `${estimate.category}: ${estimate.covered} messages fit in your plan. ${estimate.extra} more need ₹${need} in the WhatsApp wallet. Available ₹${have}.`
    );
    error.status = 402;
    throw error;
  }

  const field = CREDIT_FIELD[category] || "marketingCredits";
  if (estimate.covered) {
    const taken = await Subscription.findOneAndUpdate(
      { userId, status: "ACTIVE", endDate: { $gt: new Date() }, [field]: { $gte: estimate.covered } },
      { $inc: { [field]: -estimate.covered } },
      { new: true }
    );
    if (!taken) {
      const error = new Error("Those plan credits were just used. Refresh and try the campaign again.");
      error.status = 409;
      throw error;
    }
  }
  if (estimate.walletPaise) {
    const rupees = Number((estimate.walletPaise / 100).toFixed(2));
    const paid = await User.findOneAndUpdate(
      { _id: userId, whatsappWallet: { $gte: rupees } },
      { $inc: { whatsappWallet: -rupees } },
      { new: true }
    );
    if (!paid) {
      if (estimate.covered) {
        await Subscription.updateOne(
          { userId, status: "ACTIVE" },
          { $inc: { [field]: estimate.covered } }
        );
      }
      const error = new Error("WhatsApp wallet changed before the campaign could start. Try again.");
      error.status = 409;
      throw error;
    }
  }

  const sources = [
    ...Array(estimate.covered).fill("credit"),
    ...Array(estimate.extra).fill("wallet"),
  ];
  return { ...estimate, sources, userId };
}

async function releaseHold(hold) {
  if (!hold || !hold.userId) return;
  const field = CREDIT_FIELD[hold.category] || "marketingCredits";
  if (hold.covered) {
    await Subscription.updateOne({ userId: hold.userId, status: "ACTIVE" }, { $inc: { [field]: hold.covered } });
  }
  if (hold.walletPaise) {
    await User.updateOne(
      { _id: hold.userId },
      { $inc: { whatsappWallet: Number((hold.walletPaise / 100).toFixed(2)) } }
    );
  }
}

async function settleMessage(message, nextStatus) {
  if (!message || message.billingState !== "reserved") return;
  const failed = nextStatus === "FAILED";
  const delivered = nextStatus === "DELIVERED" || nextStatus === "READ";
  if (!failed && !delivered) return;

  const claimed = await Message.findOneAndUpdate(
    { _id: message._id, billingState: "reserved" },
    { $set: { billingState: failed ? "released" : "settled" } },
    { new: false }
  );
  if (!claimed) return;
  if (!failed) return;

  let userId = claimed.billUserId || null;
  if (!userId && claimed.campaignId) {
    const campaign = await mongoose.model("whatsappCampaign").findById(claimed.campaignId).select("createdBy").lean();
    userId = campaign && campaign.createdBy;
  }
  if (!userId) return;
  if (claimed.billSource === "wallet" && claimed.billPaise > 0) {
    await User.updateOne({ _id: userId }, { $inc: { whatsappWallet: Number((claimed.billPaise / 100).toFixed(2)) } });
  } else if (claimed.billSource === "credit") {
    const field = CREDIT_FIELD[claimed.billCategory] || "marketingCredits";
    await Subscription.updateOne({ userId, status: "ACTIVE" }, { $inc: { [field]: 1 } });
  }
}

module.exports = {
  CREDIT_FIELD,
  categoryOf,
  allowsMedia,
  ensureRates,
  rateFor,
  quote,
  reserveCampaign,
  releaseHold,
  settleMessage,
};
