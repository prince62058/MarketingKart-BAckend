const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    keywords: { type: [String], default: [] },
  },
  { _id: false }
);

const whatsappChatbotSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "chatbot", unique: true },
    extraReplyRupees: { type: Number, default: 0.8 },
    greeting: { type: String, default: "", trim: true },
    fallbackMessage: { type: String, default: "", trim: true },
    systemPrompt: { type: String, default: "", trim: true },
    handoffKeywords: { type: [String], default: [] },
    faqs: { type: [faqSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappChatbotSettings", whatsappChatbotSettingsSchema);
