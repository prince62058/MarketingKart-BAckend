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
    }
  },
  { timestamps: true }
);

whatsappConversationSchema.index({ phoneNumberId: 1, customerPhone: 1 }, { unique: true });

module.exports = mongoose.model("whatsappConversation", whatsappConversationSchema);
