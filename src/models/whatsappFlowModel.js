const mongoose = require("mongoose");

// A WhatsApp Flow (interactive form) owned by one MarketingKart user on one WABA.
// `definition` is the app's simple form model; flows imported from WhatsApp Manager have none
// and can be previewed, published and sent, but not edited in the app.
const whatsappFlowSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    wabaId: { type: String, required: true },
    metaFlowId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    categories: { type: [String], default: [] },
    starter: { type: String, default: null },
    definition: { type: mongoose.Schema.Types.Mixed, default: null },
    flowJson: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "DEPRECATED", "BLOCKED", "THROTTLED"],
      default: "DRAFT",
    },
    validationErrors: { type: [mongoose.Schema.Types.Mixed], default: [] },
    previewUrl: { type: String, default: null },
    previewExpiresAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    source: { type: String, enum: ["APP", "META"], default: "APP" },
    responseCount: { type: Number, default: 0 },
    lastResponseAt: { type: Date, default: null },
  },
  { timestamps: true }
);

whatsappFlowSchema.index({ userId: 1, wabaId: 1, updatedAt: -1 });
whatsappFlowSchema.index({ wabaId: 1, metaFlowId: 1 }, { unique: true });

module.exports = mongoose.model("whatsappFlow", whatsappFlowSchema);
