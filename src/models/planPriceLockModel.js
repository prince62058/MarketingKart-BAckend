const mongoose = require("mongoose");

const planPriceLockSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
      required: true,
      unique: true,
    },
    checks: { type: Number, default: 0 },
    frozen: { type: Boolean, default: false },
    minTier: {
      type: String,
      enum: ["starter", "standard", "premium", null],
      default: null,
    },
    quotes: {
      starter: { type: Number },
      standard: { type: Number },
      premium: { type: Number },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PlanPriceLock", planPriceLockSchema);
