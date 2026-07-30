const mongoose = require("mongoose");
const ObjectId = mongoose.Schema.Types.ObjectId;
const internalCampiagnModel = new mongoose.Schema(
  {
    creativeId: String,
    businessId: {
      type: ObjectId,
      ref: "business",
    },
    externalCampiagnId: {
      type: ObjectId,
      ref: "ExternalCampaignsModel",
    },
    title: String,
    imageId: {
      type: ObjectId,
      ref: "imageModel",
    },
    dailyBudget:{
      type: Number,
      default: 0,
    },
    imageHashId: [String],
    videoId: String,
    image: [String],
    thambnail: String,
    caption: String,
    isCallToActionEnabled: {
      type: Boolean,
      default: false,
    },
	totalBudget: {
      type: Number,
      default: 0,
    },
    callToActionId: String,
    destinationUrl: String,
    audienceId: [],
    interest: [],
    location: {},
    targetArea: String,
    audienceGender: [],
    ageRangeFrom: Number,
    fromName: String,
    ageRangeTo: Number,
    days: [
      {
        type: Number,
      },
    ],
    planId: {
      type: ObjectId,
      ref: "planModel",
    },
    facebookBudget: {
      type: Number,
      default: 0,
    },
    instaBudget: {
      type: Number,
      default: 0,
    },
    googleBudget: {
      type: Number,
      default: 0,
    },
    facebookBalance: Number,
    instaBalance: Number,
    googleBalance: Number,
    transactionId: String,
    paymentStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECT"],
      default: "PENDING",
    },
    metaAdId: String,
    googleAdId: String,
    balanceAmount: Number,
    startDate: String,
    endDate: String,
    dayStartTime: {
      type: String,
      default: "00:00",
    },
    dayEndTime: {
      type: String,
      default: "23:59",
    },
    status: {
      type: String,
      enum: [
        "ACTIVE",
        "PAUSED",
        "DELETED",
        "ARCHIVED",
        "IN_REVIEW",
        "IN_PROGRESS",
        "PREPARING",
        "COMPLETED",
        "SCHEDULED",
        "DELIVERY_ERROR",
      ],
      default: "IN_REVIEW",
    },
    isFacebookAdEnabled: {
      type: Boolean,
      default: false,
    },
    isInstaAdEnabled: {
      type: Boolean,
      default: false,
    },
    isGoogleAdEnabled: {
      type: Boolean,
      default: false,
    },
    facebookAdSetId: String,
    instaAdSetId: String,
    googleAdSetId: String,
    addTypeId: {
      type: ObjectId,
      ref: "advertisementModel",
      default: null,
    },
    startNotificationSent: {
      type: Boolean,
      default: false,
    },
    mainAdId: String,
    headline: String,
    primaryText: String,
    adtype: {
      type: String,
      enum: ["WHATSAPP", "OTHER", "CALL"],
      default: "OTHER",
    },
    mobileNumber: String,
	pageName: {
      type: String,
      default: null,
    },
    byAdmin:{
      type: Boolean,
      default: false,
    },
    metaCreateError: {
      type: String,
      default: null,
    },
	oldInsights: {
      totalReach: { type: Number, default: 0 },
      totalSpendBudget: { type: Number, default: 0 },
      totalImpression: { type: Number, default: 0 },
      totalBudget: { type: Number, default: 0 },
      totalClicks: { type: Number, default: 0 },
      totalLeads: { type: Number, default: 0 },
      totalFirstReplies: { type: Number, default: 0 },
    },
    AddAmountInsights: {
      totalReach: { type: Number, default: 0 },
      totalSpendBudget: { type: Number, default: 0 },
      totalImpression: { type: Number, default: 0 },
      totalBudget: { type: Number, default: 0 },
      totalClicks: { type: Number, default: 0 },
      totalLeads: { type: Number, default: 0 },
      totalFirstReplies: { type: Number, default: 0 },
    },
	spendAmount: {
      type: Number,
      default: 0,
    },
    // Live Meta metrics (GST-inclusive spend lives in spendAmount / totalSpendBudget)
    totalSpendBudget: {
      type: Number,
      default: 0,
    },
    totalReach: {
      type: Number,
      default: 0,
    },
    totalImpression: {
      type: Number,
      default: 0,
    },
    totalClicks: {
      type: Number,
      default: 0,
    },
    totalLeads: {
      type: Number,
      default: 0,
    },
    totalFirstReplies: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

internalCampiagnModel.index({ createdAt: -1 });
internalCampiagnModel.index({ status: 1 });
internalCampiagnModel.index({ addTypeId: 1 });
internalCampiagnModel.index({ businessId: 1 });
internalCampiagnModel.index({ startDate: 1 });
internalCampiagnModel.index({ endDate: 1 });

module.exports = mongoose.model("internalCampiagnModel", internalCampiagnModel);
