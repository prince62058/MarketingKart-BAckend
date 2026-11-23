const mongoose = require("mongoose");
const objectId = mongoose.Schema.Types.ObjectId;

const whatsappChatbotSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: objectId, ref: "userModel", required: true },
    planId: { type: objectId, ref: "whatsappChatbotPlan", required: true },
    status: { type: String, enum: ["ACTIVE", "EXPIRED", "CANCELLED"], default: "ACTIVE" },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, required: true },
    transactionId: { type: objectId, ref: "whatsappTransactionModel", default: null },
    replyCredits: { type: Number, default: 0 },
    replyAllowance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

whatsappChatbotSubscriptionSchema.index({ userId: 1, status: 1 });
whatsappChatbotSubscriptionSchema.index({ endDate: 1 });

module.exports = mongoose.model("whatsappChatbotSubscription", whatsappChatbotSubscriptionSchema);
