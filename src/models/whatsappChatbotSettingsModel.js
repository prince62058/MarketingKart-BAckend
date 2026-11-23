const mongoose = require("mongoose");

const whatsappChatbotSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "chatbot", unique: true },
    extraReplyRupees: { type: Number, default: 0.8 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappChatbotSettings", whatsappChatbotSettingsSchema);
