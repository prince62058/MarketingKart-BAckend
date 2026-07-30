const mongoose = require("mongoose");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const User = require("../models/userModel");
const WhatsAppPlan = require("../models/whatsappPlanModel");
const WhatsAppTransaction = require("../models/whatsappTransactionModel");
const WhatsAppSubscription = require("../models/whatsappSubscriptionModel");

const isAdminUser = (user) => user?.userType === "ADMIN";

const getRazorpayClient = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured on the server");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
};

const verifyRazorpaySignature = ({ orderId, paymentId, signature }) => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new Error("Razorpay is not configured on the server");
  }

  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return (
    signature &&
    expectedSignature.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))
  );
};

// ─── Razorpay Order ────────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }
    const order = await getRazorpayClient().orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `wa_${Date.now()}`,
    });
    return res.status(201).json({ success: true, order });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Add Money to WhatsApp Wallet ──────────────────────────────────────────
exports.addMoney = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { amount, transactionId, userId, orderId, paymentId, signature } = req.body;
    const roundedAmount = parseFloat(parseFloat(amount).toFixed(2));
    if (isNaN(roundedAmount) || roundedAmount <= 0) throw new Error("Invalid amount");

    const isAdminCredit = Boolean(userId);

    if (isAdminCredit && !isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can credit another user's wallet" });
    }

    if (!isAdminCredit) {
      if (!orderId || !paymentId || !signature) {
        throw new Error("Missing Razorpay payment verification details");
      }

      if (!verifyRazorpaySignature({ orderId, paymentId, signature })) {
        throw new Error("Payment verification failed");
      }

      const existingPayment = await WhatsAppTransaction.findOne({
        transactionId: paymentId,
        mode: "RAZORPAY",
      }).session(session);

      if (existingPayment) {
        throw new Error("This Razorpay payment has already been processed");
      }
    }

    let targetId = userId || req.user._id;
    let user;

    // Check if the provided userId is a 10-digit mobile number
    if (typeof targetId === 'string' && /^[0-9]{10}$/.test(targetId)) {
      user = await User.findOne({ mobile: parseInt(targetId) }).session(session);
    } else if (mongoose.Types.ObjectId.isValid(targetId)) {
      user = await User.findById(targetId).session(session);
    }

    if (!user) throw new Error("User not found");
    const targetUserId = user._id;

    const prevBal = parseFloat(user.whatsappWallet || 0);
    const newBal = parseFloat((prevBal + roundedAmount).toFixed(2));

    const [txn] = await WhatsAppTransaction.create(
      [{
        type: "CREDIT",
        amount: roundedAmount,
        userId: targetUserId,
        transactionId: isAdminCredit
          ? (transactionId || `wa_txn_${Date.now()}${Math.floor(Math.random() * 1000)}`)
          : paymentId,
        mode: isAdminCredit ? "ADMIN" : "RAZORPAY",
        description: isAdminCredit ? "Admin wallet credit" : `Razorpay wallet recharge (${orderId})`,
        previousBalance: prevBal,
        newBalance: newBal,
      }],
      { session }
    );

    user.whatsappWallet = newBal;
    await user.save({ session });
    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: "Wallet credited successfully",
      data: { walletBalance: newBal, transaction: txn },
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─── Get Wallet Balance ────────────────────────────────────────────────────
exports.getWalletBalance = async (req, res) => {
  try {
    const { userId } = req.query;
    let targetId = req.user._id;

    if (userId) {
      if (!isAdminUser(req.user)) {
        return res.status(403).json({ success: false, message: "Not authorized to view another user's wallet" });
      }
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, message: "Invalid userId format" });
      }
      targetId = userId;
    }

    const user = await User.findById(targetId).select("whatsappWallet name email");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.status(200).json({
      success: true,
      data: { balance: user.whatsappWallet || 0, name: user.name, email: user.email },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── List Transactions ─────────────────────────────────────────────────────
exports.getTransactions = async (req, res) => {
  try {
    const { page = 1, userId, type, mode, search } = req.query;
    const limit = 20;
    const query = {};

    if (userId) {
      if (!isAdminUser(req.user)) {
        return res.status(403).json({ success: false, message: "Not authorized to view another user's transactions" });
      }
      query.userId = userId;
    } else {
      query.userId = req.user._id;
    }
    if (type) query.type = type;
    if (mode) query.mode = mode;
    if (search) query.transactionId = { $regex: search, $options: "i" };

    const skip = (parseInt(page) - 1) * limit;
    const [data, total] = await Promise.all([
      WhatsAppTransaction.find(query)
        .populate("userId", "name email mobile")
        .populate("planId", "title price")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      WhatsAppTransaction.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      currentPage: parseInt(page),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Admin: List All Transactions (no userId filter required) ──────────────
exports.getAllTransactions = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can view all transactions" });
    }

    const { page = 1, type, mode, search, userId } = req.query;
    const limit = 20;
    const query = {};

    if (userId) query.userId = userId;
    if (type) query.type = type;
    if (mode) query.mode = mode;
    if (search) {
      query.$or = [
        { transactionId: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * limit;
    const [data, total] = await Promise.all([
      WhatsAppTransaction.find(query)
        .populate("userId", "name email mobile whatsappWallet")
        .populate("planId", "title price")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      WhatsAppTransaction.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      currentPage: parseInt(page),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Plans CRUD ────────────────────────────────────────────────────────────
exports.createPlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can create plans" });
    }
    const plan = await WhatsAppPlan.create(req.body);
    return res.status(201).json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPlans = async (req, res) => {
  try {
    const filter = req.query.all === 'true' ? {} : { disable: false };
    const plans = await WhatsAppPlan.find(filter).sort({ sortOrder: 1, price: 1 });
    return res.status(200).json({ success: true, data: plans });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can update plans" });
    }
    const plan = await WhatsAppPlan.findByIdAndUpdate(req.params.planId, req.body, { new: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    return res.status(200).json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.togglePlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can toggle plans" });
    }
    const plan = await WhatsAppPlan.findById(req.params.planId);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    plan.disable = !plan.disable;
    await plan.save();
    return res.status(200).json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Purchase Plan (Debit from WhatsApp Wallet) ───────────────────────────
exports.purchasePlan = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { planId } = req.body;
    const userId = req.user._id;

    const plan = await WhatsAppPlan.findById(planId);
    if (!plan || plan.disable) throw new Error("Plan not found or disabled");

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    const prevBal = parseFloat(user.whatsappWallet || 0);
    if (prevBal < plan.price) throw new Error("Insufficient wallet balance");

    const newBal = parseFloat((prevBal - plan.price).toFixed(2));

    // Create debit transaction
    const [txn] = await WhatsAppTransaction.create(
      [{
        type: "DEBIT",
        amount: plan.price,
        userId,
        transactionId: `wa_plan_${Date.now()}`,
        mode: "PLAN_PURCHASE",
        description: `Plan purchased: ${plan.title}`,
        planId: plan._id,
        previousBalance: prevBal,
        newBalance: newBal,
      }],
      { session }
    );

    // Create/update subscription
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (plan.duration || 30));

    // Expire any existing active subscription
    await WhatsAppSubscription.updateMany(
      { userId, status: "ACTIVE" },
      { status: "EXPIRED" },
      { session }
    );

    await WhatsAppSubscription.create(
      [{
        userId,
        planId: plan._id,
        status: "ACTIVE",
        startDate: new Date(),
        endDate,
        transactionId: txn._id,
      }],
      { session }
    );

    user.whatsappWallet = newBal;
    await user.save({ session });
    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: `${plan.title} plan activated!`,
      data: { walletBalance: newBal, plan: plan.title, expiresAt: endDate },
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─── Get Active Subscription ───────────────────────────────────────────────
exports.getSubscription = async (req, res) => {
  try {
    const requestedUserId = req.query.userId;
    if (requestedUserId && !isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Not authorized to view another user's subscription" });
    }

    const userId = requestedUserId || req.user._id;
    const sub = await WhatsAppSubscription.findOne({ userId, status: "ACTIVE" })
      .populate("planId")
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: sub });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
