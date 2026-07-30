const mongoose = require("mongoose");

let objectId = mongoose.Types.ObjectId;

const planModel = new mongoose.Schema(
  {
    advertisementTypeId: { type: objectId, ref: "advertisementModel" },
    title: { type: String, default: null },
    price: { type: Number, default: null },
    duretion: { type: Number, default: null },
    dailySpendBudget: { type: Number, default: null },
    aiImageCount: { type: Number, default: null },
    disable: { type: Boolean, default: false },
    instaBudget: { type: Number, default: null },
    googleBudget: { type: Number, default: null },
    facebookBudget: { type: Number, default: null },
    views: String,
    reach: String,
    leads: String,
    disable: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);
module.exports = mongoose.model("planModel", planModel);
