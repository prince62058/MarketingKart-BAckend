const mongoose = require("mongoose");

// One document (key "global") holding the rules of the "Custom Budget" tab when a customer creates an ad.
// Anything missing here falls back to the defaults in services/adBudgetSettingsService.js, so an empty
// collection means "use the built-in rules".
const adBudgetSettings = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    customEnabled: Boolean,
    minBudget: Number,
    maxBudget: Number,
    defaultBudget: Number,
    budgetPresets: [Number],
    defaultDuration: Number,
    maxDuration: Number,
    durationPresets: [Number],
    minDailySpend: Number,
    updatedBy: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("adBudgetSettings", adBudgetSettings);
