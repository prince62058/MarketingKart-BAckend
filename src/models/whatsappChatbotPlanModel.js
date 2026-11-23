const mongoose = require("mongoose");

const whatsappChatbotPlanSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true, unique: true },
    price: { type: Number, required: true },
    duration: { type: Number, default: 30 },
    replyCredits: { type: Number, required: true },
    features: [{ type: String }],
    badge: { type: String, default: null },
    color: { type: String, default: "#059669" },
    sortOrder: { type: Number, default: 0 },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappChatbotPlan", whatsappChatbotPlanSchema);
