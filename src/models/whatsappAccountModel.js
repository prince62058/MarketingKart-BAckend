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
    phoneStatus: {
      type: String,
      default: null,
    },
    codeVerificationStatus: {
      type: String,
      default: null,
    },
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
  },
  {
    timestamps: true,
    toJSON: { getters: true }, // Important to apply getters when converting to JSON
    toObject: { getters: true }
  }
);

whatsappAccountSchema.index({ userId: 1 });
whatsappAccountSchema.index({ phoneNumberId: 1 });

module.exports = mongoose.model("whatsappAccount", whatsappAccountSchema);
