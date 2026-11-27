const mongoose = require("mongoose");
const { encryptText, decryptText } = require("../utils/cryptoUtils");

const secretField = {
  type: String,
  default: "",
  set: (v) => (v ? encryptText(String(v)) : ""),
  get: (v) => (v ? decryptText(v) : ""),
  select: false,
};

// Which approved template is sent for one store event, and where the values come from.
const mappingSchema = new mongoose.Schema(
  {
    event: { type: String, required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappTemplate", required: true },
    phoneField: { type: String, default: "" },
    // Template variable → payload path ("customer.first_name") or { text: "fixed value" }.
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },
    enabled: { type: Boolean, default: true },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
  },
  { timestamps: true, minimize: false }
);

// One connected app per user: Shopify, WooCommerce, Shiprocket, LeadSquared, HubSpot, Zoho CRM, TallyPrime.
const whatsappIntegrationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true },
    app: { type: String, required: true, enum: ["shopify", "woocommerce", "shiprocket", "leadsquared", "hubspot", "zoho", "tally"] },
    // Secret part of the inbound webhook URL.
    token: { type: String, required: true, unique: true },
    // Signing secret / security token / API secret — encrypted at rest, never returned.
    secret: secretField,
    // JSON of other credentials (e.g. LeadSquared access key), encrypted.
    credentials: secretField,
    label: { type: String, default: "", maxlength: 200 },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    mappings: { type: [mappingSchema], default: [] },
    stats: {
      events: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      imported: { type: Number, default: 0 },
      lastEventAt: { type: Date, default: null },
      lastSyncAt: { type: Date, default: null },
      lastError: { type: String, default: "" },
    },
  },
  { timestamps: true, minimize: false, toJSON: { getters: false }, toObject: { getters: false } }
);

whatsappIntegrationSchema.index({ userId: 1, app: 1 }, { unique: true });

module.exports = mongoose.model("whatsappIntegration", whatsappIntegrationSchema);
