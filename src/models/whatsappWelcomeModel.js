// One welcome WhatsApp per number per product (WhatsApp Marketing, Meta Ads app, AI Video).
const mongoose = require("mongoose");

const whatsappWelcomeSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    product: { type: String, enum: ["whatsapp", "meta_ads", "ai_video"], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", default: null },
    status: { type: String, enum: ["SENDING", "SENT", "FAILED"], default: "SENDING" },
    template: { type: String, default: "" },
    wamid: { type: String, default: null },
    error: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

whatsappWelcomeSchema.index({ phone: 1, product: 1 }, { unique: true });

module.exports = mongoose.models.whatsappWelcome || mongoose.model("whatsappWelcome", whatsappWelcomeSchema);
