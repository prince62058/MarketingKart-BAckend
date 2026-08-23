const crypto = require("crypto");
const Subscription = require("../models/subscriptionModel");
const Manager = require("../models/managerModel");

const TIER_PRICES = {
  starter: 15999,
  standard: 25999,
  premium: 35999,
};

const ADDON_PRICES = {
  linkedin: 1999,
  gmb: 3999,
};

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

function computeMonthlyAmount(tier, addons = []) {
  const base = TIER_PRICES[tier];
  if (!base) return null;
  if (tier !== "starter") return base;
  const addonTotal = (addons || []).reduce((sum, a) => sum + (ADDON_PRICES[a] || 0), 0);
  return base + addonTotal;
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

    const monthlyAmount = computeMonthlyAmount(tier, addons);
    if (!monthlyAmount) {
      return res.status(400).json({ success: false, message: "Could not compute plan amount" });
    }

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ success: false, message: "Missing Razorpay payment verification details" });
    }
    if (!verifyRazorpaySignature({ orderId, paymentId, signature })) {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
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
