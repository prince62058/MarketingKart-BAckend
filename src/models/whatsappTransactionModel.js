const mongoose = require("mongoose");
const objectId = mongoose.Schema.Types.ObjectId;

const whatsappTransactionModel = new mongoose.Schema(
  {
    type: { type: String, enum: ["CREDIT", "DEBIT"], required: true },
    amount: { type: Number, required: true },
    userId: { type: objectId, ref: "userModel", required: true },
    transactionId: { type: String, trim: true },
    mode: { type: String, enum: ["RAZORPAY", "ADMIN", "PLAN_PURCHASE"], default: "RAZORPAY" },
    description: { type: String, default: null },
    planId: { type: objectId, ref: "whatsappPlanModel", default: null },
    previousBalance: { type: Number, default: 0 },
    newBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

whatsappTransactionModel.index({ userId: 1, createdAt: -1 });
whatsappTransactionModel.index({ type: 1 });
whatsappTransactionModel.index({ mode: 1 });

module.exports = mongoose.model("whatsappTransactionModel", whatsappTransactionModel);
