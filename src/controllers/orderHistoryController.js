const { mongoose } = require("mongoose");
const OrderHistory = require("../models/orderHistoryModel");
const { createTransaction } = require("./transtionController");
const userModel = require("../models/userModel");

exports.createOrderHistory = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // 1. Validate request body
    const { amount, userId, type, businessId, orderdDetail, ...orderData } = req.body;
    if (!amount || !userId) {
      throw new Error('Amount and userId are required');
    }
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    // 2. Verify user exists and has sufficient balance
    const user = await userModel.findById(userId).session(session);
    if (!user) {
      throw new Error('User not found');
    }


    // 3. Create transaction record
    const transaction = await createTransaction({
      type: "DEBIT",
      amount: amount,
      userId: userId,
      adsType: type,
      businessId: businessId,
      description: `Order purchase - ${orderData.orderId || ''}`.trim()
    }, session);

    // 4. Update user wallet (precise calculation)
    user.wallet = parseFloat((user.wallet - amount).toFixed(2));
    await user.save({ session });

    // 5. Create order history
    const orderHistory = new OrderHistory({
      ...orderData,
      amount,
      type:type,
      userId,
      orderdDetail: orderdDetail,
      transactionId: transaction._id  // Link to transaction
    });
    await orderHistory.save({ session });

    // 6. Commit transaction if all operations succeed
    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: {
        order: orderHistory,
        newBalance: user.wallet,
        transactionId: transaction?._id
      }
    });

  } catch (error) {
    // 7. Rollback on any error
    await session.abortTransaction();

    console.error('Order creation error:', error);
    return res.status(400).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    // 8. Always end the session
    await session.endSession();
  }
};

// Read all order histories
exports.getOrderHistories = async (req, res) => {
  try {
    const { userId } = req.query;
    let obj = {};
    if (userId) {
      obj.userId = userId;
    }
    const histories = await OrderHistory.find(obj).sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      message: "Fetched successfully",
      data: histories,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Read a single order history by ID
exports.getOrderHistoryById = async (req, res) => {
  try {
    const history = await OrderHistory.findById(req.query.orderId);
    if (!history)
      return res
        .status(404)
        .json({ success: false, message: "Order history not found" });
    res.json({ success: true, message: "Fetched successfully", data: history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.updateOrderHistory = async (req, res) => {
  try {
    const { orderId } = req.query; // /order-history/:orderId

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    const updatedHistory = await OrderHistory.findByIdAndUpdate(
      {_id:orderId},
      { $set: {orderdDetail: req.body.orderdDetail} },
      { new: true, runValidators: true }
    );

    if (!updatedHistory) {
      return res.status(404).json({ success: false, message: "Order history not found" });
    }

    return res.json({
      success: true,
      message: "Order history updated successfully",
      data: updatedHistory,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Delete an order history by ID
exports.deleteOrderHistory = async (req, res) => {
  try {
    const history = await OrderHistory.findByIdAndDelete(req.query.orderId);
    if (!history)
      return res
        .status(404)
        .json({ success: false, message: "Order history not found" });
    res.json({ success: true, message: "Order history deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.getOrderHistoriesAdmin = async (req, res) => {
  try {
    const { userId, page = 1, limit = 20 } = req.query;
    let obj = {};
    if (userId) {
      obj.userId = userId;
    }
    const skip = (page - 1) * limit;
    const histories = await OrderHistory.find(obj)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    const total = await OrderHistory.countDocuments(obj);
    res.json({
      success: true,
      message: "Fetched successfully",
      data: histories,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
