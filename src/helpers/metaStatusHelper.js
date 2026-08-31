const axios = require("axios");
const internalCampaignModel = require("../models/internalCampiagnModel");

const GRAPH = "https://graph.facebook.com/v22.0";

/**
 * Meta's `effective_status` → the status we show the advertiser.
 *
 * effective_status already rolls the campaign and ad set up into the ad, so a
 * paused ad set surfaces here as ADSET_PAUSED rather than the ad looking live.
 */
const META_STATUS_MAP = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ADSET_PAUSED: "PAUSED",
  CAMPAIGN_PAUSED: "PAUSED",
  DELETED: "COMPLETED",
  ARCHIVED: "COMPLETED",
  IN_PROCESS: "PREPARING",
  PREAPPROVED: "PREPARING",
  PENDING_BILLING_INFO: "PREPARING",
  PENDING_REVIEW: "IN_REVIEW",
  // Meta looked at the ad and said no. Kept apart from DELIVERY_ERROR (our own
  // failure to build the ad) because the advertiser has to do something
  // different about each.
  DISAPPROVED: "REJECTED",
  WITH_ISSUES: "DELIVERY_ERROR",
};

/** Terminal states we should not overwrite with a Meta reading. */
const LOCAL_TERMINAL = new Set(["COMPLETED", "DELETED"]);

/** First human-readable line Meta offers about why an ad is not running. */
const readIssue = (issues) => {
  const first = Array.isArray(issues) ? issues[0] : null;
  if (!first) return null;
  return (
    first.error_user_msg ||
    first.error_user_title ||
    first.error_summary ||
    first.error_message ||
    null
  );
};

/**
 * Reads one ad's live state from Meta.
 * Returns null when there is nothing to read (no id, no token, or Meta errored).
 */
const fetchMetaAdStatus = async (adId) => {
  const token = process.env.systemUserAccessToken || process.env.admin_access_token;
  if (!adId || !token) return null;

  try {
    const { data } = await axios.get(`${GRAPH}/${adId}`, {
      params: {
        // issues_info carries the rejection reason; without it a disapproved ad
        // is just a red badge with nothing the advertiser can act on.
        fields: "effective_status,issues_info",
        access_token: token,
      },
      timeout: 8000,
    });
    if (!data?.effective_status) return null;
    return {
      effectiveStatus: data.effective_status,
      reason: readIssue(data.issues_info),
    };
  } catch (error) {
    console.warn(
      `[metaStatus] ${adId}: ${error.response?.data?.error?.message || error.message}`,
    );
    return null;
  }
};

/**
 * Refreshes a batch of campaigns against Meta and persists anything that moved.
 *
 * Campaigns are read in parallel — one round trip each, done serially, made the
 * ads list take a second per ad.
 *
 * @param {Array} campaigns mongoose docs or lean objects with _id/status/mainAdId
 * @returns {Promise<Map<string, object>>} campaign id → { status, metaEffectiveStatus, metaStatusReason }
 */
const syncCampaignStatuses = async (campaigns = []) => {
  const results = new Map();
  const targets = campaigns.filter(
    (c) => c && (c.mainAdId || c.metaAdId) && !LOCAL_TERMINAL.has(c.status),
  );
  if (!targets.length) return results;

  const writes = [];

  await Promise.all(
    targets.map(async (campaign) => {
      const meta = await fetchMetaAdStatus(campaign.mainAdId || campaign.metaAdId);
      if (!meta) return;

      const mapped = META_STATUS_MAP[meta.effectiveStatus] || campaign.status;
      const patch = {
        metaEffectiveStatus: meta.effectiveStatus,
        metaStatusReason: meta.reason || null,
        metaStatusSyncedAt: new Date(),
      };
      // An admin's explicit pause is a local decision; Meta agreeing that it is
      // paused should not flip anything else about the row.
      if (mapped !== campaign.status) patch.status = mapped;

      results.set(String(campaign._id), { ...patch, status: mapped });
      writes.push({
        updateOne: { filter: { _id: campaign._id }, update: { $set: patch } },
      });
    }),
  );

  if (writes.length) {
    try {
      await internalCampaignModel.bulkWrite(writes, { ordered: false });
    } catch (error) {
      console.warn("[metaStatus] bulk persist failed:", error.message);
    }
  }

  return results;
};

/** Applies a sync result back onto the in-memory docs being serialized. */
const applyStatusToDocs = (campaigns = [], results) => {
  if (!results?.size) return campaigns;
  for (const campaign of campaigns) {
    const patch = results.get(String(campaign?._id));
    if (!patch) continue;
    for (const [key, value] of Object.entries(patch)) {
      campaign[key] = value;
      if (campaign._doc) campaign._doc[key] = value;
    }
  }
  return campaigns;
};

module.exports = {
  META_STATUS_MAP,
  fetchMetaAdStatus,
  syncCampaignStatuses,
  applyStatusToDocs,
};
