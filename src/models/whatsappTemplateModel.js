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
      enum: ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION", "CAROUSEL"],
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
            enum: ["QUICK_REPLY", "PHONE_NUMBER", "URL", "FLOW", "CATALOG", "OTP", "COPY_CODE"],
          },
          text: String,
          // The sample offer code of a COPY_CODE button, used when a send gives none.
          example: String,
          phoneNumber: String,
          url: String,
          flowId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappFlow" },
          metaFlowId: String,
        },
      ],
      default: [],
    },
    // WhatsApp Manager's template types: DEFAULT, CATALOG and FLOW (form button),
    // CALL_PERMISSION (calling permissions request) and OTP (authentication).
    templateType: {
      type: String,
      enum: ["DEFAULT", "CATALOG", "FLOW", "CALL_PERMISSION", "OTP"],
      default: "DEFAULT",
    },
    metaFlowId: { type: String, default: null },
    otp: {
      addSecurityRecommendation: Boolean,
      codeExpirationMinutes: Number,
      buttonText: String,
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
    // Templates belong to a Meta WABA/phone — cleared when the user connects a different number.
    wabaId: {
      type: String,
      default: null,
      index: true,
    },
    phoneNumberId: {
      type: String,
      default: null,
      index: true,
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

whatsappTemplateSchema.virtual("rejectionReason").get(function rejectionReason() {
  return this.rejectedReason || "";
});
whatsappTemplateSchema.set("toJSON", { virtuals: true });
whatsappTemplateSchema.set("toObject", { virtuals: true });

whatsappTemplateSchema.index({ status: 1 });
whatsappTemplateSchema.index({ businessId: 1 });
whatsappTemplateSchema.index({ createdBy: 1, wabaId: 1 });

module.exports = mongoose.model("whatsappTemplate", whatsappTemplateSchema);
