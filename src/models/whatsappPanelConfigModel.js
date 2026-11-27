const mongoose = require("mongoose");

// One row ("global"): how the WhatsApp customer panel looks and what it offers to everyone.
const featureSchema = new mongoose.Schema(
  { enabled: { type: Boolean, default: true }, message: { type: String, default: "", maxlength: 280 } },
  { _id: false }
);

const whatsappPanelConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    features: { type: Map, of: featureSchema, default: {} },
    announcement: {
      enabled: { type: Boolean, default: false },
      tone: { type: String, enum: ["info", "success", "warning", "danger"], default: "info" },
      title: { type: String, default: "", maxlength: 120 },
      text: { type: String, default: "", maxlength: 500 },
      linkLabel: { type: String, default: "", maxlength: 40 },
      linkUrl: { type: String, default: "", maxlength: 500 },
      startsAt: { type: Date, default: null },
      endsAt: { type: Date, default: null },
    },
    // Defaults for every customer; a customer's own limit (whatsappControl.limits) wins.
    limits: {
      apiPerMinute: { type: Number, default: null },
      dailyMessages: { type: Number, default: null },
      campaignRatePerMinute: { type: Number, default: null },
      maxCampaignContacts: { type: Number, default: null },
    },
    menu: {
      hidden: { type: [String], default: [] },
      labels: { type: Map, of: String, default: {} },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", default: null },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.models.whatsappPanelConfig || mongoose.model("whatsappPanelConfig", whatsappPanelConfigSchema);
