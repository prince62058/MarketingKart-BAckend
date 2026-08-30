const mongoose = require("mongoose");
let objectId = mongoose.Types.ObjectId;
const mongoosePaginate = require('mongoose-paginate-v2');

const transtion = new mongoose.Schema(
  {
    type: { type: String, trim: true, enum: ["DEBIT", "CREDIT"] },
    walletType: { type: String, trim: true, enum: ["MAIN", "WHATSAPP"], default: "MAIN" },
    amount: Number,
    gstAmount: Number,
    serviceAmount: Number,
    paymentGetwayAmount: Number,
    businessId: { type: objectId, ref: "business" },
    adsType: { type: String },
    adsId: { type: objectId, ref: "internalCampiagnModel" },
    userId: { type: objectId, ref: "userModel" },
    transactionId: { type: String, trim: true },
    addTypeId: { type: objectId, ref: "advertisementModel" },
    description: { type: String, trim: true },
    previousBalance: { type: Number },
    newBalance: { type: Number },
  },
  { timestamps: true }
);
transtion.plugin(mongoosePaginate);

transtion.index({ createdAt: -1 });
transtion.index({ type: 1 });
transtion.index({ userId: 1 });
transtion.index({ businessId: 1 });
transtion.index({ adsId: 1 });

module.exports = mongoose.model("transtionModel", transtion);
