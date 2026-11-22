const mongoose = require("mongoose");

const whatsappPlanModel = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    code: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    price: { type: Number, required: true },
    duration: { type: Number, default: 30 }, // days
    contactLimit: { type: Number, default: 100 },
    campaignLimit: { type: Number, default: 5 }, // per month
    templateLimit: { type: Number, default: 3 },
    // Messages included in the plan. Each category is spent only on that category.
    marketingCredits: { type: Number, default: 0 },
    utilityCredits: { type: Number, default: 0 },
    authenticationCredits: { type: Number, default: 0 },
    serviceCredits: { type: Number, default: 0 },
    features: [{ type: String }],
    badge: { type: String, default: null }, // e.g. "BEST VALUE", "POPULAR"
    color: { type: String, default: "#314fb2" },
    sortOrder: { type: Number, default: 0 },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappPlanModel", whatsappPlanModel);
