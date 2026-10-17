const crypto = require("crypto");
const Razorpay = require("razorpay");
const Subscription = require("../models/subscriptionModel");
const Manager = require("../models/managerModel");
const PlanPriceLock = require("../models/planPriceLockModel");

const TIER_PRICES = {
  starter: 15999,
  standard: 25999,
  premium: 35999,
};

const TIER_RANK = { starter: 0, standard: 1, premium: 2 };
const PRICE_BAND = 2000;
const MAX_PRICE_CHECKS = 2;

const ADDON_PRICES = {
  linkedin: 1999,
  gmb: 3999,
};

function rollPrice(ceiling) {
  const floor = ceiling - PRICE_BAND;
  return floor + Math.floor(Math.random() * (PRICE_BAND + 1));
}

function presentLock(lock) {
  const quotes = lock?.quotes || {};
  return {
    checks: lock?.checks || 0,
    maxChecks: MAX_PRICE_CHECKS,
    frozen: Boolean(lock?.frozen),
    minTier: lock?.minTier || null,
    ceilings: TIER_PRICES,
    prices: {
      starter: Number.isFinite(quotes.starter) ? quotes.starter : null,
      standard: Number.isFinite(quotes.standard) ? quotes.standard : null,
      premium: Number.isFinite(quotes.premium) ? quotes.premium : null,
    },
  };
}

function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return false;
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return (
    !!signature &&
    expectedSignature.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  );
}

function computeMonthlyAmount(tier, addons = [], lock) {
  const quoted = lock?.quotes?.[tier];
  const base = quoted || TIER_PRICES[tier];
  if (!base) return null;
  if (tier !== "starter") return base;
  const addonTotal = (addons || []).reduce((sum, a) => sum + (ADDON_PRICES[a] || 0), 0);
  return base + addonTotal;
}

async function razorpayOrderPaise(orderId) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = await razorpay.orders.fetch(orderId);
  return Number(order.amount);
}

async function assignManager() {
  const managers = await Manager.find({ active: true });
  if (!managers.length) return null;
  const existingCount = await Subscription.countDocuments();
  return managers[existingCount % managers.length];
}

exports.createSubscription = async (req, res) => {
  try {
    const {
      tier,
      platforms = [],
      goals = [],
      addons = [],
      paymentMethod,
      businessId,
      orderId,
      paymentId,
      signature,
    } = req.body;

    if (!["starter", "standard", "premium"].includes(tier)) {
      return res.status(400).json({ success: false, message: "Invalid plan tier" });
    }

    const lock = await PlanPriceLock.findOne({ userId: req.user._id });
    if (lock?.frozen && lock.minTier && TIER_RANK[tier] < TIER_RANK[lock.minTier]) {
      return res.status(400).json({
        success: false,
        message: "This price is locked. Buy this plan or a higher plan.",
      });
    }

    const monthlyAmount = computeMonthlyAmount(tier, addons, lock);
    if (!monthlyAmount) {
      return res.status(400).json({ success: false, message: "Could not compute plan amount" });
    }

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, message: "Missing Razorpay payment verification details" });
    }
    if (!verifyRazorpaySignature({ orderId, paymentId, signature })) {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }
    const paidPaise = await razorpayOrderPaise(orderId);
    if (paidPaise !== Math.round(monthlyAmount * 100)) {
      return res.status(400).json({ success: false, message: "Paid amount does not match the locked plan price" });
    }
    const existingPayment = await Subscription.findOne({ "lastPayment.paymentId": paymentId });
    if (existingPayment) {
      return res.status(400).json({ success: false, message: "This payment has already been processed" });
    }

    const manager = await assignManager();

    const subscription = await Subscription.create({
      userId: req.user._id,
      businessId,
      tier,
      platforms,
      goals,
      addons,
      monthlyAmount,
      paymentMethod,
      managerId: manager?._id,
      status: "ACTIVE",
      startDate: new Date(),
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastPayment: {
        orderId,
        paymentId,
        amount: monthlyAmount,
        paidAt: new Date(),
      },
    });

    const populated = await subscription.populate("managerId");

    return res.status(201).json({
      success: true,
      message: "Subscription activated successfully",
      data: populated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPlanPrices = async (req, res) => {
  try {
    const lock = await PlanPriceLock.findOne({ userId: req.user._id });
    return res.status(200).json({
      success: true,
      message: "Plan prices fetched",
      data: presentLock(lock),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkPlanPrice = async (req, res) => {
  try {
    const { tier } = req.body;
    if (!TIER_PRICES[tier]) {
      return res.status(400).json({ success: false, message: "Invalid plan tier" });
    }

    const userId = req.user._id;
    let lock = await PlanPriceLock.findOne({ userId });
    if (lock?.frozen || (lock && lock.checks >= MAX_PRICE_CHECKS)) {
      return res.status(200).json({
        success: true,
        message: "Price is locked",
        data: presentLock(lock),
      });
    }

    const price = rollPrice(TIER_PRICES[tier]);
    if (!lock) {
      try {
        lock = await PlanPriceLock.create({
          userId,
          checks: 1,
          frozen: false,
          quotes: { [tier]: price },
        });
        return res.status(200).json({
          success: true,
          message: "Price updated",
          data: presentLock(lock),
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        lock = await PlanPriceLock.findOne({ userId });
        return res.status(200).json({
          success: true,
          message: lock?.frozen ? "Price locked" : "Price updated",
          data: presentLock(lock),
        });
      }
    }

    const nextChecks = lock.checks + 1;
    const updated = await PlanPriceLock.findOneAndUpdate(
      { userId, checks: lock.checks, frozen: false },
      {
        $set: {
          checks: nextChecks,
          frozen: nextChecks >= MAX_PRICE_CHECKS,
          minTier: nextChecks >= MAX_PRICE_CHECKS ? tier : null,
          [`quotes.${tier}`]: price,
        },
      },
      { new: true },
    );

    const current = updated || (await PlanPriceLock.findOne({ userId }));
    return res.status(200).json({
      success: true,
      message: current?.frozen ? "Price locked" : "Price updated",
      data: presentLock(current),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMySubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      userId: req.user._id,
      status: "ACTIVE",
    })
      .sort({ createdAt: -1 })
      .populate("managerId");

    return res.status(200).json({
      success: true,
      message: subscription ? "Subscription fetched successfully" : "No active subscription",
      data: subscription,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
