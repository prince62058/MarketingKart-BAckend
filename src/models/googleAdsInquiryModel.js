const mongoose = require("mongoose");

const googleAdsInquirySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
      default: null,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "business",
      default: null,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    contactPerson: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      default: "",
    },
    websiteUrl: {
      type: String,
      trim: true,
      default: "",
    },
    campaignGoal: {
      type: String,
      required: true,
      trim: true,
      default: "Lead Generation",
    },
    monthlyBudget: {
      type: String,
      required: true,
      trim: true,
      default: "₹10,000 - ₹25,000",
    },
    targetLocation: {
      type: String,
      trim: true,
      default: "Pan India",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["PENDING", "CONTACTED", "IN_PROGRESS", "CONVERTED", "REJECTED"],
      default: "PENDING",
    },
    assignedStaff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
      default: null,
    },
  },
  { timestamps: true }
);

const GoogleAdsInquiry = mongoose.model("GoogleAdsInquiry", googleAdsInquirySchema);

module.exports = GoogleAdsInquiry;
