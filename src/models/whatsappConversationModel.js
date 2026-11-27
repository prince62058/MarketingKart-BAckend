const mongoose = require("mongoose");

const whatsappConversationSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "business",
      required: false, // In case we get messages for an account without mapping somehow
    },
    wabaId: {
      type: String,
      required: true,
      index: true,
    },
    phoneNumberId: {
      type: String,
      required: true,
      index: true,
    },
    customerPhone: {
      type: String,
      required: true, // E.164 without '+'
    },
    contactSyncedAt: Date,
    customerName: {
      type: String,
      default: "Unknown",
    },
    lastMessage: {
      type: String, // Truncated preview of the last message
      default: "",
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["OPEN", "CLOSED"],
      default: "OPEN"
    },
    isBotActive: {
      type: Boolean,
      default: true,
    },
    // Labels on this chat (manual from the inbox, or from a Link & QR / label keyword match).
    labels: [{ type: mongoose.Schema.Types.ObjectId, ref: "whatsappLabel" }],
    // The Click-to-WhatsApp ad that started this chat: first touch, never overwritten. The click id
    // is a personal identifier that only the Conversions API needs, so normal reads leave it out.
    ctwa: {
      clid: { type: String, select: false },
      adId: String,
      sourceType: String,
      sourceUrl: String,
      headline: String,
      mediaType: String,
      capturedAt: Date,
    },
  },
  { timestamps: true }
);

whatsappConversationSchema.index({ phoneNumberId: 1, customerPhone: 1 }, { unique: true });

module.exports = mongoose.model("whatsappConversation", whatsappConversationSchema);
