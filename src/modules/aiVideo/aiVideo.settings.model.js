const mongoose = require("mongoose");

// One document holds every value an admin can change. Anything not saved here falls back to the
// defaults in aiVideo.logic.js, so an untouched database behaves exactly like the shipped app.
const packSchema = new mongoose.Schema(
  { id: String, credits: Number, price: Number, active: { type: Boolean, default: true } },
  { _id: false },
);

const planSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    price: Number,
    yearlyPrice: Number,
    monthlyCredits: Number,
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    enabled: Boolean,
    videoCost: Number,
    voiceoverCost: Number,
    photoAvatarCost: Number,
    videoAvatarCost: Number,
    freeCredits: Number,
    maxScriptChars: Number,
    maxConcurrentRenders: Number,
    resolution: String,
    packs: [packSchema],
    plans: [planSchema],
    presenters: { priya: String, raj: String },
    updatedBy: String,
  },
  { timestamps: true, minimize: false },
);

// Who changed what, so a credit balance or a price never changes without a trace.
const auditSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now, index: true },
    adminId: String,
    adminName: String,
    action: { type: String, index: true },
    studioId: String,
    userId: String,
    summary: String,
    data: mongoose.Schema.Types.Mixed,
  },
  { versionKey: false },
);

module.exports = {
  Settings: mongoose.models.AiVideoSettings || mongoose.model("AiVideoSettings", settingsSchema),
  Audit: mongoose.models.AiVideoAudit || mongoose.model("AiVideoAudit", auditSchema),
};
