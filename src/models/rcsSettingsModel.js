const mongoose = require("mongoose");

// One document for every RCS value admins can change. Secrets stay in env.
const rcsSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },
    enabled: Boolean,
    maxImportContacts: Number,
    maxSendBatch: Number,
    defaultTemplateId: String,
    defaultDemoImageUrl: String,
    defaultButtonUrl: String,
    defaultCampaignName: String,
    defaultCampaignText: String,
    defaultCardTitle: String,
    defaultButtonLabel: String,
    providerDisplayName: String,
    providerMessageType: String,
    providerBannerTitle: String,
    providerBannerText: String,
    providerWorkspaceTitle: String,
    providerWorkspaceBody: String,
    providerFooterNote: String,
    billingBadge: String,
    billingHeadline: String,
    billingSubhead: String,
    billingCaption: String,
    billingFootnote: String,
    billingExploreCta: String,
    yearlySaveHint: String,
    dashboardBadge: String,
    dashboardTitle: String,
    dashboardSubtitle: String,
    dashboardCta: String,
    dashboardOnboardingTitle: String,
    helpHowTitle: String,
    helpHowBody: String,
    helpBeforeTitle: String,
    helpBeforeBody: String,
    helpShareMessage: String,
    saasEyebrow: String,
    saasBannerTitle: String,
    saasBannerText: String,
    defaultSenderName: String,
    defaultSenderWebsite: String,
    updatedBy: String,
  },
  { timestamps: true, minimize: false }
);

module.exports =
  mongoose.models.RcsSettings || mongoose.model("RcsSettings", rcsSettingsSchema);
