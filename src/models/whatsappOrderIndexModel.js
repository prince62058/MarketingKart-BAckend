const mongoose = require("mongoose");

// The customer behind a store order, remembered from Shopify/WooCommerce order events so a
// Shiprocket tracking update (which carries no phone number) can reach the right customer.
const whatsappOrderIndexSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true },
    ref: { type: String, required: true },
    phone: { type: String, required: true },
    name: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
  },
  { versionKey: false }
);

whatsappOrderIndexSchema.index({ userId: 1, ref: 1 }, { unique: true });

module.exports = mongoose.model("whatsappOrderIndex", whatsappOrderIndexSchema);
