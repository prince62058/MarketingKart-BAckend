const mongoose = require("mongoose");
const { encryptText, decryptText } = require("../utils/cryptoUtils");

const whatsappAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
      required: true,
      unique: true, // Typically one WABA account per user
    },
    phoneNumber: {
      type: String,
      default: null,
    },
    verifiedName: {
      type: String,
      default: null,
    },
    qualityRating: {
      type: String,
      default: null,
    },
    qualityEvent: { type: String, default: null },
    messagingLimit: { type: String, default: null },
    accountReviewStatus: { type: String, default: null },
    healthEvents: [
      {
        _id: false,
        key: String,
        field: String,
        event: String,
        severity: String,
        message: String,
        receivedAt: Date,
      },
    ],
    phoneStatus: {
      type: String,
      default: null,
    },
    codeVerificationStatus: {
      type: String,
      default: null,
    },
    onboardingMode: { type: String, enum: ['NEW_OR_MIGRATE','BUSINESS_APP'], default: 'NEW_OR_MIGRATE' },
    // PLATFORM: MarketingKart pays Meta and charges the wallet. CUSTOMER: their own WABA bill, so we do not charge the message again.
    billingMode: { type: String, enum: ["PLATFORM", "CUSTOMER"], default: "PLATFORM" },
    coexistenceSync: {
      contactsRequestId: String, historyRequestId: String,
      contactsRequestedAt: Date, historyRequestedAt: Date,
      historyStatus: String, historyProgress: {type:Number,default:0},
    },
    disconnectionReason: String,
    businessName: {
      type: String,
      default: null,
    },
    connectedVia: {
      type: String,
      enum: ["MANUAL", "FACEBOOK", "EMBEDDED_SIGNUP"],
      default: "MANUAL",
    },
    tokenExpiresAt: {
      type: Date,
      default: null,
    },
    phoneNumberId: {
      type: String,
      required: true,
    },
    wabaId: {
      type: String,
      required: true,
    },
    accessToken: {
      type: String,
      required: true,
      // Store encrypted but provide plain via getters automatically
      set: function (plainToken) {
        // Only encrypt if it's not already encrypted (i.e. contains colon delimiter from cryptoUtils)
        if (plainToken && plainToken.includes && plainToken.includes(":")) {
          return plainToken; 
        }
        return encryptText(plainToken);
      },
      get: function (encryptedToken) {
        return decryptText(encryptedToken);
      }
    },
    status: {
      type: String,
      enum: ["CONNECTED", "DISCONNECTED"],
      default: "CONNECTED",
    },
    // Conversions API dataset of the connected WABA, saved after the first lookup. Only trusted
    // while wabaId still matches the account's wabaId (a reconnect can switch WABA).
    capiDataset: {
      datasetId: String,
      wabaId: String,
      savedAt: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true, transform: (_doc, ret) => { delete ret.accessToken; return ret; } }, // Important to apply getters when converting to JSON
    toObject: { getters: true }
  }
);

whatsappAccountSchema.index({ userId: 1 });
whatsappAccountSchema.index({ phoneNumberId: 1 });

module.exports = mongoose.model("whatsappAccount", whatsappAccountSchema);
