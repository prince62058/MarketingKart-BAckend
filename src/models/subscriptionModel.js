const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
      required: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "business",
    },
    tier: {
      type: String,
      enum: ["starter", "standard", "premium"],
      required: true,
    },
    platforms: [{ type: String }],
    goals: [{ type: String }],
    addons: [{ type: String }],
    monthlyAmount: { type: Number, required: true },
    paymentMethod: { type: String },
    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Manager",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "CANCELLED"],
      default: "ACTIVE",
    },
    startDate: { type: Date, default: Date.now },
    nextBillingDate: { type: Date },
    lastPayment: {
      orderId: String,
      paymentId: String,
      amount: Number,
      paidAt: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
