	  const Transaction = require("../models/transtionModel");
  const mongoose = require("mongoose");
  const User = require("../models/userModel");
  const Razorpay = require('razorpay');
  const crypto = require('crypto');

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  const verifyRazorpaySignature = ({ orderId, paymentId, signature }) => {
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
  };

  // Create Razorpay order
  const createOrder = async (req, res) => {
    try {
      const { amount } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "Invalid amount" });
      }

      const order = await razorpay.orders.create({
        amount: amount * 100,
        currency: "INR",
        receipt: `receipt_${Date.now()}`  
      });

      res.status(201).json({ 
        success: true, 
        order 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  };



const createTransactions = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();

    const {
      paymentId,
      orderId,
      signature,
      type = "CREDIT", // CREDIT or DEBIT
      amount,
      businessId,
      adsId,
      transactionId,
      serviceAmount,
      description
    } = req.body;

    // Convert amount to number and validate
    const transactionAmount = parseFloat(amount);
    if (isNaN(transactionAmount)) {
      throw new Error("Amount must be a valid number");
    }

    // Round to 2 decimal places for currency
    const roundedAmount = parseFloat(transactionAmount.toFixed(2));

    if (!["CREDIT", "DEBIT"].includes(type)) {
      throw new Error("Invalid transaction type (must be CREDIT or DEBIT)");
    }

    // The authenticated caller always pays/gets credited for themselves —
    // a client-supplied userId is never trusted, only an admin may target another user.
    const isAdminCredit = Boolean(req.body.userId) && req.user?.userType === "ADMIN";
    const userId = isAdminCredit ? req.body.userId : req.user._id;

    if (type === "CREDIT" && !isAdminCredit) {
      // A self-service credit must be a real, verified Razorpay payment.
      if (!orderId || !paymentId || !signature) {
        throw new Error("Missing Razorpay payment verification details");
      }
      if (!verifyRazorpaySignature({ orderId, paymentId, signature })) {
        throw new Error("Payment verification failed");
      }
      const existingPayment = await Transaction.findOne({ transactionId: paymentId }).session(session);
      if (existingPayment) {
        throw new Error("This Razorpay payment has already been processed");
      }
    }

    // Fetch user with session
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new Error("User not found");
    }

    // Convert user wallet to number (in case it's stored as string)
    const currentBalance = parseFloat(user.wallet);

    // Handle transaction
    let newBalance;
    if (type === "DEBIT") {
      if (currentBalance < roundedAmount) {
        throw new Error("Insufficient wallet balance");
      }
      newBalance = parseFloat((currentBalance - roundedAmount).toFixed(2));
    } else {
      newBalance = parseFloat((currentBalance + roundedAmount).toFixed(2));
    }

    // Create transaction record
    const transactionData = {
      type,
      amount: roundedAmount,
      businessId,
      adsId,
      userId,
      transactionId: paymentId || transactionId || generateTransactionId(),
      serviceAmount: serviceAmount ? parseFloat(serviceAmount).toFixed(2) : null,
      description,
      previousBalance: currentBalance,
      newBalance
    };

    const [transaction] = await Transaction.create([transactionData], { session });

    // Update user wallet
    user.wallet = newBalance;
    await user.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      data: {
        walletBalance: user.wallet,
        transaction,
      },
      message: getTransactionMessage(type, paymentId)
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Transaction error:", error);
    
    return res.status(400).json({
      success: false,
      message: error.message || "Transaction failed",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  } finally {
    session.endSession();
  }
};

// Helper function to generate transaction ID if not provided
function generateTransactionId() {
  return 'txn_' + Date.now() + Math.floor(Math.random() * 1000);
}

function getTransactionMessage(type, paymentId) {
  return type === "DEBIT" 
    ? "Amount debited successfully" 
    : paymentId 
      ? "Payment verified and wallet credited" 
      : "Manual credit transaction successful";
}

// // Create Transaction Controller
// const createTransactions = async (req, res) => {
//   const session = await mongoose.startSession();
//   try {
//     session.startTransaction();

  //     const {
  //       type = "CREDIT",
  //       amount,
  //       businessId,
  //       adsId,
  //       userId,
  //       serviceAmount,
  //       transactionId,
  //     } = req.body;

  //     if (!type || !amount) {
  //       throw new Error("Type and amount are required");
  //     }



  //     const newTransaction = new Transaction({
  //       type,
  //       amount: amount,
  //       buinessId: businessId,
  //       adsId,
  //       userId,
  //       transactionId
  //     });

  //     await user.findByIdAndUpdate(
  //       userId,
  //       { $inc: { wallet: amount } },
  //       { session }
  //     );
  //     // Save with session
  //     const savedTransaction = await newTransaction.save({ session });

  //     await session.commitTransaction();

  //     res.status(201).json({
  //       success: true,
  //       data: savedTransaction,
  //       message: "Transaction created successfully",
  //     });
  //   } catch (error) {
  //     await session.abortTransaction();
  //     res.status(500).json({
  //       success: false,
  //       message: error.message,
  //     });
  //   } finally {
  //     session.endSession();
  //   }
  // };
  // List Transactions Controller with Pagination
  const listTransactions = async (req, res) => {
    try {
      // Extract query parameters with defaults
      let { page = 1, limit = 20, userId, businessId, type, startDate, endDate, search, sortBy, sortOrder, mode } = req.query;

      // Validate and sanitize inputs
      page = Math.max(1, parseInt(page)) || 1;
      limit = Math.min(20, Math.max(1, parseInt(limit))) || 10; // Enforce max 20 per page

      // Build filter object
      const filter = {};
      // Non-admins can only ever see their own transactions — a client-supplied
      // userId is only honored for admins (e.g. the admin panel's transaction list).
      if (req.user?.userType === "ADMIN") {
        if (userId) filter.userId = userId;
      } else {
        filter.userId = req.user._id;
      }
      if (businessId) filter.businessId = businessId;
      if (type) filter.type = type;

      // Mode filter (RAZORPAY vs WALLET)
      if (mode === 'RAZORPAY') {
        filter.transactionId = { $regex: /^pay_/i };
      } else if (mode === 'WALLET') {
        filter.transactionId = { $regex: /^(?!pay_)/i }; // Not starting with pay_
      }

      // Date range filter
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          filter.createdAt.$lte = end;
        }
      }

      // Search filter (User ID, Email, or Transaction ID)
      if (search) {
        const users = await User.find({
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
          ]
        }).select('_id');
        const userIds = users.map(u => u._id);
        
        filter.$or = [
          { userId: { $in: userIds } },
          { transactionId: { $regex: search, $options: 'i' } }
        ];
      }

      // Configure sorting
      const sort = {};
      if (sortBy) {
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      } else {
        sort.createdAt = -1;
      }

      // Configure pagination options
      const options = {
        page,
        limit,
        sort,
        populate: [
          { path: "userId", select: "name email" },
          { path: "businessId", select: "businessName" }, // Fixed typo here too
          { path: "adsId", select: "title" },
          { path: "addTypeId", select: "title" },
        ],
      };

      const transactions = await Transaction.paginate(filter, options);

      // Format response
      res.status(200).json({
        success: true,
        message: "Transactions retrieved successfully",
        data: transactions.docs,
          page: transactions.totalPages,

      });
    } catch (error) {
      console.error("Transaction list error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve transactions",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  };

  // Get Transaction by ID Controller
  const getTransactionById = async (req, res) => {
    try {
      const { transactionId } = req.query;

      // Validate ID format
      if (!mongoose.Types.ObjectId.isValid(transactionId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid transaction ID format",
        });
      }

      const transaction = await Transaction.findById(transactionId)
        .populate("userId", "name email")
        .populate("buinessId", "businessName")
        .populate("addTypeId", "advertisementType");

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: "Transaction not found",
        });
      }

      res.status(200).json({
        success: true,
        message: "Transaction retrieved successfully",
        data: transaction,
      
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  };

  async function createTransaction(transactionData, session = null) {
    try {
      const transaction = await Transaction.create(
        [
          {
            type: transactionData.type,
            amount: transactionData.amount,
            businessId: transactionData.businessId,
            adsId: transactionData.adsId,
            userId: transactionData.userId,
            gstAmount: transactionData.gstAmount || 0,
            serviceAmount: transactionData.serviceAmount || 0,
            paymentGatewayAmount: transactionData.paymentGatewayAmount || 0,
            createdAt: new Date(),
            addTypeId: transactionData?.addTypeId,
			adsType:transactionData.adsType,
          },
        ],
        session ? { session } : {} // Use session if provided
      );
      return transaction[0]._id;
    } catch (error) {
      console.error("Error creating transaction:", error.message);
      throw error;
    }
  }

  module.exports = {
    createTransaction,
    createTransactions,
    getTransactionById,
    listTransactions,
    createOrder
  };
