const mongoose = require("mongoose");

const rcsPlanModel = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    monthlyPrice: { type: Number, required: true, min: 0 },
    annualMonthlyPrice: { type: Number, required: true, min: 0 },
    tagline: { type: String, default: "", trim: true },
    features: [{ type: String }],
    cta: { type: String, default: "Choose plan", trim: true },
    badge: { type: String, default: null },
    color: { type: String, default: "#7C3AED" },
    featured: { type: Boolean, default: false },
    teamMembers: { type: Number, default: 5 },
    contactLimit: { type: Number, default: 5000 },
    campaignLimit: { type: Number, default: 50 },
    sortOrder: { type: Number, default: 0 },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("rcsPlanModel", rcsPlanModel);
