const mongoose = require("mongoose");

const replySchema = new mongoose.Schema({
  message: { type: String, required: true },
  sender: { type: String, enum: ["USER", "ADMIN"], required: true },
  senderName: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const whatsappSupportSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    category: {
      type: String,
      enum: ["TRANSACTION", "TECHNICAL", "PLAN", "CALLBACK", "GENERAL"],
      default: "GENERAL",
    },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
      default: "OPEN",
      index: true,
    },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "MEDIUM",
    },
    callbackRequested: { type: Boolean, default: false },
    callbackNumber: { type: String },
    replies: [replySchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("WhatsAppSupport", whatsappSupportSchema);
