const mongoose = require("mongoose");

// One row: which customer-facing products are live vs in maintenance.
const moduleFlagsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    metaAds: { type: Boolean, default: true },
    whatsapp: { type: Boolean, default: true },
    aiVideo: { type: Boolean, default: true },
    rcs: { type: Boolean, default: true },
    googleAds: { type: Boolean, default: true },
    messages: {
      metaAds: { type: String, default: "" },
      whatsapp: { type: String, default: "" },
      aiVideo: { type: String, default: "" },
      rcs: { type: String, default: "" },
      googleAds: { type: String, default: "" },
    },
    updatedBy: String,
  },
  { timestamps: true, minimize: false }
);

module.exports =
  mongoose.models.ModuleFlags || mongoose.model("ModuleFlags", moduleFlagsSchema);
