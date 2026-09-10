const mongoose = require("mongoose");

const whatsappCampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "whatsappTemplate",
      required: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "business",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
    },
    status: {
      type: String,
      enum: ["DRAFT", "SCHEDULED", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "PAUSED"],
      default: "DRAFT",
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    // How fast this campaign is allowed to go out. The queue spaces its jobs
    // by 60s / this, which is what actually enforces it.
    sendRatePerMinute: {
      type: Number,
      default: 60,
    },
    totalContacts: {
      type: Number,
      default: 0,
    },
    // Maps template variable positions to contact field names
    // e.g. { "1": "name", "2": "phone" }
    variableMapping: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    stats: {
      queued: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

whatsappCampaignSchema.index({ status: 1 });
whatsappCampaignSchema.index({ createdBy: 1 });
whatsappCampaignSchema.index({ businessId: 1 });
whatsappCampaignSchema.index({ createdAt: -1 });

module.exports = mongoose.model("whatsappCampaign", whatsappCampaignSchema);
