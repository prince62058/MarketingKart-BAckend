const mongoose = require("mongoose");

const whatsappTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    language: {
      type: String,
      default: "en_US",
    },
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
      required: true,
    },
    components: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },
    metaTemplateId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "IN_APPEAL", "PAUSED", "DISABLED"],
      default: "PENDING",
    },
    rejectedReason: {
      type: String,
      default: "",
    },
    bodyText: {
      type: String,
      required: true,
    },
    headerType: {
      type: String,
      enum: ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"],
      default: "NONE",
    },
    headerText: {
      type: String,
      default: "",
    },
    headerMediaUrl: {
      type: String,
      default: "",
    },
    footerText: {
      type: String,
      default: "",
    },
    buttons: {
      type: [
        {
          type: {
            type: String,
            enum: ["QUICK_REPLY", "PHONE_NUMBER", "URL"],
          },
          text: String,
          phoneNumber: String,
          url: String,
        },
      ],
      default: [],
    },
    marketingType: {
      type: String,
      enum: ["CUSTOM", "PRODUCT", "CAROUSEL"],
      default: "CUSTOM",
    },
    variables: {
      type: [String],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "business",
    },
    disable: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

whatsappTemplateSchema.index({ status: 1 });
whatsappTemplateSchema.index({ businessId: 1 });

module.exports = mongoose.model("whatsappTemplate", whatsappTemplateSchema);
