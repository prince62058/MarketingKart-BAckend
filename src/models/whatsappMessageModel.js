const mongoose = require("mongoose");

const whatsappMessageSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "whatsappCampaign",
      required: false, // Optional for direct CRM messages
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "whatsappConversation",
      required: false, // Optional for campaign broadcasts without a UI thread yet
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "business",
      required: false,
    },
    phoneNumberId: {
      type: String,
      required: false,
      index: true,
    },
    // Phone in E.164 format e.g. "919876543210"
    to: {
      type: String,
      required: true,
    },
    contactName: {
      type: String,
      default: "",
    },
    // Resolved variable values for this contact e.g. { "1": "Ravi", "2": "9876543210" }
    variables: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // New fields for 2-way CRM
    direction: {
      type: String,
      enum: ["INBOUND", "OUTBOUND"],
      default: "OUTBOUND",
    },
    type: {
      type: String,
      enum: ["TEXT", "TEMPLATE", "MEDIA", "INTERACTIVE", "UNKNOWN"],
      default: "TEMPLATE",
    },
    textBody: {
      type: String, // Contents of free-form text or the template text sent
      default: "",
    },
    // wamid returned by Meta after send
    metaMessageId: {
      type: String,
      default: null,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"],
      default: "QUEUED",
    },
    errorCode: {
      type: String,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

whatsappMessageSchema.index({ campaignId: 1 });
whatsappMessageSchema.index({ metaMessageId: 1 }, { sparse: true });
whatsappMessageSchema.index({ status: 1 });
whatsappMessageSchema.index({ to: 1 });
whatsappMessageSchema.index({ phoneNumberId: 1, to: 1, direction: 1, createdAt: -1 });

module.exports = mongoose.model("whatsappMessage", whatsappMessageSchema);
