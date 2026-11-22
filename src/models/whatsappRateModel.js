const mongoose = require("mongoose");

// Prices are integer paise (₹1.10 = 110) so balances are not stored as floats.
const whatsappRateSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE", "AUTHENTICATION_INTERNATIONAL"],
      required: true,
      unique: true,
    },
    metaPaise: { type: Number, required: true },
    sellPaise: { type: Number, required: true },
    country: { type: String, default: "IN" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappRate", whatsappRateSchema);
