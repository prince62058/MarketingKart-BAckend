const mongoose = require("mongoose");

const premiumPlanSubSchema = new mongoose.Schema({
  label: { type: String, required: true },
  amount: { type: String, required: true },
  leads: { type: String, required: true },
  reach: { type: String, required: true },
  views: { type: String, required: true },
  duration: { type: Number, default: 30 },
  isActive: { type: Boolean, default: true }
});

const premiumPlanSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, required: true },
  value: { type: String, required: true, unique: true },
  color: { type: String, default: '#1565C0' },
  darkColor: { type: String, default: '#0D47A1' },
  lightBg: { type: String, default: '#E8F1FF' },
  accentBg: { type: String, default: '#BBDEFB' },
  disclaimer: { type: String, default: '' },
  status: { type: Boolean, default: true },
  plans: [premiumPlanSubSchema]
}, { timestamps: true });

module.exports = mongoose.model("PremiumPlan", premiumPlanSchema);
