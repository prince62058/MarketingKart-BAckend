const RcsSettings = require("../models/rcsSettingsModel");
const RcsPlan = require("../models/rcsPlanModel");
const { providerConfig } = require("./bhashRcsService");

const DEFAULTS = Object.freeze({
  enabled: true,
  maxImportContacts: 500,
  maxSendBatch: 100,
  defaultTemplateId: "bsl_image_demo",
  defaultDemoImageUrl: "https://bhashsms.com/pushwa/iframe/files/rcsdp.jpg",
  defaultButtonUrl: "https://marketingkart.in",
  defaultCampaignName: "Violet gift box",
  defaultCampaignText:
    "Hi {{firstName}}, the violet gift box is ready. Tap Buy now to order.",
  defaultCardTitle: "Violet gift box",
  defaultButtonLabel: "Buy now",
  providerDisplayName: "Bhash RCS",
  providerMessageType: "Image template",
  providerBannerTitle: "Behind every great conversation.",
  providerBannerText: "Connect your delivery provider when you are ready.",
  providerWorkspaceTitle: "MarketingKart workspace",
  providerWorkspaceBody:
    "Contacts, campaigns, and conversations stay with this account and business. Delivery starts after a provider is connected.",
  providerFooterNote:
    "Switching providers should not change your contacts or campaign workflow. The delivery integration belongs behind your backend API.",
  billingBadge: "SIMPLE PLANS. ROOM TO GROW.",
  billingHeadline: "Start a conversation.\nScale your business.",
  billingSubhead:
    "Choose the workspace that fits your team. Provider messaging charges are separate.",
  billingCaption: "Workspace plans. Message charges are billed by your provider.",
  billingFootnote:
    "Your plan is saved with this workspace. Checkout is collected when billing is enabled.",
  billingExploreCta: "Explore plans",
  yearlySaveHint: "",
  dashboardBadge: "RCS WORKSPACE",
  dashboardTitle: "Send RCS from\none workspace.",
  dashboardSubtitle: "Sender, audience, and campaigns together.",
  dashboardCta: "Create campaign",
  dashboardOnboardingTitle: "Make it yours",
  helpHowTitle: "How a workspace gets live",
  helpHowBody:
    "1. Add your sender profile.\n2. Add or import opted-in contacts.\n3. Write a campaign and select its audience.\n4. Save the draft and prepare it.\n5. Reply from the inbox once conversations start.",
  helpBeforeTitle: "Before the first live send",
  helpBeforeBody:
    "Your workspace is saved with this account. A provider must verify the sender before messages leave MarketingKart. Provider keys stay on the server.",
  helpShareMessage:
    "MarketingKart RCS: set up a sender, add contacts, create a campaign, then reply from the inbox.",
  saasEyebrow: "MARKETINGKART CLOUD",
  saasBannerTitle: "Better conversations start here.",
  saasBannerText:
    "Your brand, your audience, your team. One connected RCS workspace.",
  defaultSenderName: "MarketingKart",
  defaultSenderWebsite: "https://marketingkart.in",
});

const STRING_FIELDS = [
  "defaultTemplateId",
  "defaultDemoImageUrl",
  "defaultButtonUrl",
  "defaultCampaignName",
  "defaultCampaignText",
  "defaultCardTitle",
  "defaultButtonLabel",
  "providerDisplayName",
  "providerMessageType",
  "providerBannerTitle",
  "providerBannerText",
  "providerWorkspaceTitle",
  "providerWorkspaceBody",
  "providerFooterNote",
  "billingBadge",
  "billingHeadline",
  "billingSubhead",
  "billingCaption",
  "billingFootnote",
  "billingExploreCta",
  "yearlySaveHint",
  "dashboardBadge",
  "dashboardTitle",
  "dashboardSubtitle",
  "dashboardCta",
  "dashboardOnboardingTitle",
  "helpHowTitle",
  "helpHowBody",
  "helpBeforeTitle",
  "helpBeforeBody",
  "helpShareMessage",
  "saasEyebrow",
  "saasBannerTitle",
  "saasBannerText",
  "defaultSenderName",
  "defaultSenderWebsite",
];

const NUMBER_FIELDS = ["maxImportContacts", "maxSendBatch"];

const CACHE_MS = 15 * 1000;
let cache = null;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function merge(stored) {
  const result = { ...DEFAULTS };
  if (!stored) return result;
  if (stored.enabled !== undefined && stored.enabled !== null) {
    result.enabled = Boolean(stored.enabled);
  }
  for (const field of NUMBER_FIELDS) {
    if (typeof stored[field] === "number" && Number.isFinite(stored[field])) {
      result[field] = stored[field];
    }
  }
  for (const field of STRING_FIELDS) {
    if (typeof stored[field] === "string") result[field] = stored[field];
  }
  return result;
}

function wholeNumber(value, label, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw httpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

function trimString(value, label, max) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw httpError(400, `${label} must be ${max} characters or fewer.`);
  return text;
}

function validate(input) {
  if (!input || typeof input !== "object") throw httpError(400, "Send the RCS settings.");
  const patch = {};
  if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
  if (input.maxImportContacts !== undefined) {
    patch.maxImportContacts = wholeNumber(input.maxImportContacts, "Max import contacts", 10, 10000);
  }
  if (input.maxSendBatch !== undefined) {
    patch.maxSendBatch = wholeNumber(input.maxSendBatch, "Max send batch", 1, 500);
  }
  for (const field of STRING_FIELDS) {
    if (input[field] !== undefined) {
      patch[field] = trimString(input[field], field, field.includes("Body") || field.includes("Text") || field.includes("headline") || field.includes("Headline") || field.includes("message") || field.includes("Message") || field.includes("Footnote") || field.includes("Subhead") || field.includes("Caption") ? 2000 : 240);
    }
  }
  return patch;
}

async function get({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const stored = await RcsSettings.findOne({ key: "global" }).lean();
  const value = merge(stored);
  cache = { at: Date.now(), value };
  return value;
}

function peek() {
  return cache ? cache.value : { ...DEFAULTS };
}

function invalidate() {
  cache = null;
}

async function update(input, admin) {
  const patch = validate(input);
  const saved = await RcsSettings.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        ...patch,
        updatedBy: (admin && (admin.name || admin.email)) || "admin",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  invalidate();
  return merge(saved);
}

async function getCatalog() {
  const [settings, plans] = await Promise.all([
    get(),
    RcsPlan.find({ disable: false, monthlyPrice: { $gt: 0 } }).sort({
      sortOrder: 1,
      monthlyPrice: 1,
    }),
  ]);
  const provider = providerConfig();
  return {
    settings,
    plans,
    provider: {
      configured: provider.configured,
      provider: provider.provider,
      sender: provider.sender,
      messageType: provider.messageType,
      displayName: settings.providerDisplayName,
    },
  };
}

module.exports = {
  DEFAULTS,
  get,
  peek,
  update,
  invalidate,
  getCatalog,
};
