const mongoose = require("mongoose");

const whatsappPlanModel = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    price: { type: Number, required: true },
    duration: { type: Number, default: 30 }, // days
    contactLimit: { type: Number, default: 100 },
    campaignLimit: { type: Number, default: 5 }, // per month
    templateLimit: { type: Number, default: 3 },
    features: [{ type: String }],
    badge: { type: String, default: null }, // e.g. "BEST VALUE", "POPULAR"
    color: { type: String, default: "#314fb2" },
    sortOrder: { type: Number, default: 0 },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappPlanModel", whatsappPlanModel);
