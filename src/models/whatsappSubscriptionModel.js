const mongoose = require("mongoose");
const objectId = mongoose.Schema.Types.ObjectId;

const whatsappSubscriptionModel = new mongoose.Schema(
  {
    userId: { type: objectId, ref: "userModel", required: true },
    planId: { type: objectId, ref: "whatsappPlanModel", required: true },
    status: { type: String, enum: ["ACTIVE", "EXPIRED", "CANCELLED"], default: "ACTIVE" },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, required: true },
    transactionId: { type: objectId, ref: "whatsappTransactionModel", default: null },
  },
  { timestamps: true }
);

whatsappSubscriptionModel.index({ userId: 1, status: 1 });
whatsappSubscriptionModel.index({ endDate: 1 });

module.exports = mongoose.model("whatsappSubscriptionModel", whatsappSubscriptionModel);
