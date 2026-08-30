const advertisementModel = require("../models/advertisementModel");

/**
 * What an ad actually *does*, independent of which database row happens to
 * describe it.
 *
 * The controllers used to branch on hardcoded advertisementModel _ids. Those
 * ids belong to whichever database seeded them, so re-seeding (or restoring a
 * backup) silently broke every branch: WhatsApp ads lost their click-to-chat
 * destination, Lead ads stopped getting a lead form attached, and both were
 * pushed to Meta as plain REACH campaigns that could never produce a lead.
 * `advertisementType` is a schema enum and is stable across every database, so
 * that is what we key on now.
 */
const AD_KIND = {
  LEAD_FORM: "LEAD_FORM",
  WHATSAPP: "WHATSAPP",
  CALL: "CALL",
  TRAFFIC: "TRAFFIC",
  APP: "APP",
  ENGAGEMENT: "ENGAGEMENT",
  AWARENESS: "AWARENESS",
  SALES: "SALES",
  OTHER: "OTHER",
};

const TYPE_TO_KIND = {
  LEADS: AD_KIND.LEAD_FORM,
  WHATSAPP_MESSAGES: AD_KIND.WHATSAPP,
  CALLS: AD_KIND.CALL,
  WEBSITE_VISITORS: AD_KIND.TRAFFIC,
  STORE_VISITS: AD_KIND.TRAFFIC,
  APP_INSTALLS: AD_KIND.APP,
  POST_ENGAGEMENT: AD_KIND.ENGAGEMENT,
  PAGE_LIKES: AD_KIND.ENGAGEMENT,
  EVENT_RESPONSES: AD_KIND.ENGAGEMENT,
  VIDEO_VIEWS: AD_KIND.AWARENESS,
  PRODUCT_CATALOG_SALES: AD_KIND.SALES,
  OFFER_CLAIMS: AD_KIND.SALES,
};

/** Meta campaign objective for each kind. */
const KIND_TO_META_OUTCOME = {
  [AD_KIND.LEAD_FORM]: "OUTCOME_LEADS",
  [AD_KIND.WHATSAPP]: "OUTCOME_ENGAGEMENT",
  [AD_KIND.CALL]: "OUTCOME_LEADS",
  [AD_KIND.TRAFFIC]: "OUTCOME_TRAFFIC",
  [AD_KIND.APP]: "APP_INSTALLS",
  [AD_KIND.ENGAGEMENT]: "OUTCOME_ENGAGEMENT",
  [AD_KIND.AWARENESS]: "OUTCOME_AWARENESS",
  [AD_KIND.SALES]: "OUTCOME_SALES",
};

/** Sync: kind from the `advertisementType` enum value. */
const kindFromAdvertisementType = (advertisementType) =>
  TYPE_TO_KIND[String(advertisementType || "").toUpperCase()] || AD_KIND.OTHER;

/** Sync: Meta objective from an `advertisementType` enum value. */
const metaOutcomeFromAdvertisementType = (advertisementType) =>
  KIND_TO_META_OUTCOME[kindFromAdvertisementType(advertisementType)] || null;

// The advertisement collection is tiny and effectively static, so one cached
// id → kind lookup keeps the hot ad-creation path from re-reading it.
const kindCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Async: kind for an advertisementModel _id. Pass the already-loaded document
 * as `adTypeDoc` (processAdCreation has one) to skip the query entirely.
 */
const resolveAdKind = async (addTypeId, { adTypeDoc, session } = {}) => {
  if (adTypeDoc?.advertisementType) {
    return kindFromAdvertisementType(adTypeDoc.advertisementType);
  }
  const id = String(addTypeId || "");
  if (!id) return AD_KIND.OTHER;

  const cached = kindCache.get(id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.kind;

  const query = advertisementModel.findById(id).select("advertisementType");
  if (session) query.session(session);
  const doc = await query.lean();

  const kind = kindFromAdvertisementType(doc?.advertisementType);
  kindCache.set(id, { kind, at: Date.now() });
  return kind;
};

/** Resolve the id of the ad type that carries a given kind, or null. */
const findAdTypeIdByKind = async (kind) => {
  const types = Object.entries(TYPE_TO_KIND)
    .filter(([, k]) => k === kind)
    .map(([type]) => type);
  if (!types.length) return null;
  const doc = await advertisementModel
    .findOne({ advertisementType: { $in: types } })
    .select("_id")
    .lean();
  return doc?._id || null;
};

module.exports = {
  AD_KIND,
  TYPE_TO_KIND,
  KIND_TO_META_OUTCOME,
  kindFromAdvertisementType,
  metaOutcomeFromAdvertisementType,
  resolveAdKind,
  findAdTypeIdByKind,
};
