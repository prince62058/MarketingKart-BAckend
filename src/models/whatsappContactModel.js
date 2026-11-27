const mongoose = require("mongoose");

// A customer's saved WhatsApp contact. One row per (owner, phone); phone is digits with country code.
const whatsappContactSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true },
    groups: [{ type: mongoose.Schema.Types.ObjectId, ref: "whatsappContactGroup" }],
    source: {
      type: String,
      enum: ["Direct", "Imported", "Organic", "API", "Lead Gen", "Click-to-WhatsApp", "Link & QR", "HubSpot", "Zoho CRM", "LeadSquared"],
      default: "Direct",
    },
    subscribed: { type: Boolean, default: true },
    // Values for the owner's custom fields, keyed by field key.
    custom: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

whatsappContactSchema.index({ userId: 1, phone: 1 }, { unique: true });
whatsappContactSchema.index({ userId: 1, groups: 1 });
whatsappContactSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("whatsappContact", whatsappContactSchema);
