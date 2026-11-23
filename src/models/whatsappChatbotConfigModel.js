const mongoose = require("mongoose");

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    keywords: { type: [String], default: [] },
  },
  { _id: true }
);

const DEFAULT_HANDOFF = [
  "human",
  "agent",
  "talk to person",
  "speak to someone",
  "talk to human",
  "customer care",
  "insan",
  "agent se baat",
];

const whatsappChatbotConfigSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
      required: true,
      unique: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "business",
      required: false,
      index: true,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    businessName: {
      type: String,
      default: "",
      trim: true,
    },
    greeting: {
      type: String,
      default: "Hi! Thanks for messaging us. How can we help you today?",
      trim: true,
    },
    fallbackMessage: {
      type: String,
      default: "Thanks for your message. A team member will get back to you shortly.",
      trim: true,
    },
    faqs: {
      type: [faqSchema],
      default: [],
    },
    handoffKeywords: {
      type: [String],
      default: () => [...DEFAULT_HANDOFF],
    },
    systemPrompt: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

whatsappChatbotConfigSchema.statics.DEFAULT_HANDOFF = DEFAULT_HANDOFF;

module.exports = mongoose.model("whatsappChatbotConfig", whatsappChatbotConfigSchema);
