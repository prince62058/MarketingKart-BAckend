const axios = require("axios");
const leadModel = require("../models/leadModel");
const leadFormModel = require("../models/leadFormsModel");
const internalCampaignModel = require("../models/internalCampiagnModel");
const businessModel = require("../models/businessModel");
const { sendLeadNotification } = require("../helpers/appNotificationHelper");

const GRAPH = "https://graph.facebook.com/v22.0";

/**
 * Pulls Instant Form leads out of Meta and into the Leads tab.
 *
 * The webhook is the fast path, but it only ever fires once: if the Page
 * subscription was not in place, if the server was restarting, or if the ad was
 * created before the Page was linked, that lead is gone for good. This is the
 * catch-up pass — it asks Meta for the leads of every form we created for a
 * business and upserts whatever is missing, so a lead can be late but never
 * lost.
 *
 * Called three ways:
 *  - the hourly cron, for every business with lead ads,
 *  - the app's pull-to-refresh on the Leads tab (`syncLeadsNow`),
 *  - the Ad Detail screen, for one campaign.
 */

/** Campaign states whose forms can still be collecting leads. */
const SYNCABLE_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "IN_REVIEW",
  "PREPARING",
  "SCHEDULED",
  "IN_PROGRESS",
  // A finished campaign still receives stragglers for a while, and its leads
  // must not silently stop arriving the moment the budget runs out.
  "COMPLETED",
];

const MAX_PAGES_PER_FORM = 10;
const PAGE_SIZE = 200;

const firstValue = (lead, keys) => {
  for (const key of keys) {
    const value = lead[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
};

/** Meta field names vary by form; these are the ones our forms produce. */
const PHONE_KEYS = [
  "phone_number",
  "phone",
  "mobile_number",
  "mobile",
  "work_phone_number",
  "work_phone",
];
const NAME_KEYS = ["full_name", "name", "first_name"];
const EMAIL_KEYS = ["email", "work_email"];
const WHATSAPP_KEYS = ["whatsapp_number", "whatsapp"];

/** One page of a form's leads, flattened so field_data reads like a record. */
async function fetchFormLeads(formId, token, { since = null } = {}) {
  const leads = [];
  let after = null;
  let pages = 0;

  do {
    const params = {
      access_token: token,
      limit: PAGE_SIZE,
      fields: "created_time,ad_id,adset_id,campaign_id,form_id,field_data",
    };
    if (after) params.after = after;
    if (since) {
      // Meta returns leads newest first, so this keeps a nightly catch-up from
      // paging through years of history on every run.
      params.filtering = JSON.stringify([
        { field: "time_created", operator: "GREATER_THAN", value: since },
      ]);
    }

    const { data } = await axios.get(`${GRAPH}/${formId}/leads`, {
      params,
      timeout: 20000,
    });

    for (const lead of data?.data || []) {
      const record = {
        id: lead.id,
        created_time: lead.created_time,
        ad_id: lead.ad_id || null,
        adset_id: lead.adset_id || null,
        campaign_id: lead.campaign_id || null,
        form_id: lead.form_id || formId,
      };
      for (const field of lead.field_data || []) {
        if (field?.name) record[field.name] = (field.values || []).join(", ");
      }
      leads.push(record);
    }

    after = data?.paging?.cursors?.after || null;
    pages += 1;
  } while (after && pages < MAX_PAGES_PER_FORM);

  return leads;
}

/**
 * Which of our campaigns a Meta lead belongs to.
 *
 * The ad id is the precise answer. The form is the fallback, and it matters:
 * an ad rebuilt after a reset has a new ad id that no lead carries yet, and
 * without this those leads would be dropped as "not one of ours".
 */
function resolveCampaignForLead(lead, { adIdMap, form }) {
  const byAd = lead.ad_id ? adIdMap.get(String(lead.ad_id)) : null;
  if (byAd) return byAd;
  return form?.campaign || null;
}

/**
 * Unique Meta forms for a business, each with the campaign to fall back to.
 *
 * Several campaigns can share one Page form — Meta reuses an existing active
 * form rather than making a second one. The ad id decides attribution for
 * almost every lead; the campaign kept here is only for leads whose ad we no
 * longer recognise, and the newest campaign on the form is the best guess for
 * those.
 */
function buildFormMap(formDocs, campaignById) {
  const newer = (a, b) => new Date(a?.createdAt || 0) > new Date(b?.createdAt || 0);
  const forms = new Map();
  for (const doc of formDocs) {
    if (!doc.formId) continue;
    const entry = forms.get(doc.formId) || { formId: doc.formId, campaign: null };
    const campaign = campaignById.get(String(doc.internalCampiagnId));
    if (campaign && (!entry.campaign || newer(campaign, entry.campaign))) {
      entry.campaign = campaign;
    }
    forms.set(doc.formId, entry);
  }
  return forms;
}

/**
 * @param {string|object} businessId
 * @param {object} options
 * @param {string} options.internalCampaignId only this campaign's forms
 * @param {number} options.sinceUnix only leads newer than this (seconds)
 * @returns {Promise<{created:number,fetched:number,forms:number,skipped:number,reason?:string}>}
 */
async function syncLeadsForBusiness(businessId, options = {}) {
  const { internalCampaignId = null, sinceUnix = null } = options;
  const result = { created: 0, updated: 0, fetched: 0, forms: 0, skipped: 0 };
  let recentlyCreated = 0;

  const business = await businessModel
    .findById(businessId)
    .select("pageId pageAccessToken userId businessName")
    .lean();
  if (!business) return { ...result, reason: "Business not found" };

  const token = business.pageAccessToken || process.env.systemUserAccessToken;
  if (!token) return { ...result, reason: "Facebook Page is not linked" };

  // Every form we ever created for this business, with the campaign it was
  // built for. Page forms we did not create are deliberately not synced —
  // they belong to whatever else the customer runs on that Page.
  const formQuery = { businessId: business._id };
  if (internalCampaignId) formQuery.internalCampiagnId = internalCampaignId;
  const formDocs = await leadFormModel
    .find(formQuery)
    .select("formId internalCampiagnId")
    .lean();
  if (!formDocs.length) return { ...result, reason: "No lead forms yet" };

  const campaignQuery = {
    businessId: business._id,
    status: { $in: SYNCABLE_STATUSES },
  };
  if (internalCampaignId) campaignQuery._id = internalCampaignId;
  const campaigns = await internalCampaignModel
    .find(campaignQuery)
    .select("_id mainAdId metaAdId facebookAdSetId instaAdSetId createdAt")
    .lean();

  const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));
  const adIdMap = new Map();
  for (const campaign of campaigns) {
    for (const adId of [campaign.mainAdId, campaign.metaAdId]) {
      if (adId) adIdMap.set(String(adId), campaign);
    }
  }

  const forms = buildFormMap(formDocs, campaignById);

  for (const form of forms.values()) {
    let metaLeads = [];
    try {
      metaLeads = await fetchFormLeads(form.formId, token, { since: sinceUnix });
    } catch (error) {
      const detail = error.response?.data?.error?.message || error.message;
      // An expired Page token is the single most common reason leads stop
      // arriving. The system user token can read the same form as long as the
      // Page is in our Business Manager, so it is worth one more try before
      // giving up on the form entirely.
      const systemToken = process.env.systemUserAccessToken;
      if (systemToken && systemToken !== token) {
        try {
          metaLeads = await fetchFormLeads(form.formId, systemToken, {
            since: sinceUnix,
          });
          console.warn(
            `[leadSync] form ${form.formId}: page token failed (${detail}) — recovered with the system token`,
          );
        } catch (retryError) {
          console.warn(
            `[leadSync] form ${form.formId}:`,
            retryError.response?.data?.error?.message || retryError.message,
          );
          continue;
        }
      } else {
        console.warn(`[leadSync] form ${form.formId}:`, detail);
        continue;
      }
    }

    result.forms += 1;
    result.fetched += metaLeads.length;

    // One read for the whole form instead of one per lead: a first sync of a
    // busy form is hundreds of leads, and a round trip each made it slow enough
    // to time out the request the app is waiting on.
    const leadgenIds = metaLeads.map((lead) => lead.id).filter(Boolean);
    const existingDocs = await leadModel
      .find({ leadgenId: { $in: leadgenIds } })
      .select("_id leadgenId userContactNumber name email internalCampiagnId")
      .lean();
    const existingByLeadgenId = new Map(
      existingDocs.map((doc) => [String(doc.leadgenId), doc]),
    );

    const writes = [];

    for (const lead of metaLeads) {
      if (!lead.id) continue;

      const campaign = resolveCampaignForLead(lead, { adIdMap, form });
      if (!campaign) {
        result.skipped += 1;
        continue;
      }

      const phone = firstValue(lead, PHONE_KEYS);
      const contact = {
        name: firstValue(lead, NAME_KEYS),
        email: firstValue(lead, EMAIL_KEYS),
        userContactNumber: phone,
        whatsappNumber: firstValue(lead, WHATSAPP_KEYS) || phone,
      };

      const existing = existingByLeadgenId.get(String(lead.id));

      if (existing) {
        // The webhook creates the row first and fills the contact details in a
        // second call, which is exactly the call that fails when a Page token
        // has expired. Backfill anything still blank rather than leaving a
        // nameless lead with no number in the app.
        const patch = {};
        if (!existing.userContactNumber && contact.userContactNumber) {
          patch.userContactNumber = contact.userContactNumber;
          patch.whatsappNumber = contact.whatsappNumber;
        }
        if (!existing.name && contact.name) patch.name = contact.name;
        if (!existing.email && contact.email) patch.email = contact.email;
        if (!existing.internalCampiagnId) patch.internalCampiagnId = campaign._id;
        if (Object.keys(patch).length) {
          writes.push({
            updateOne: { filter: { _id: existing._id }, update: { $set: patch } },
          });
          result.updated += 1;
        }
        continue;
      }

      writes.push({
        updateOne: {
          filter: { leadgenId: lead.id },
          update: {
            $setOnInsert: {
              businessId: business._id,
              internalCampiagnId: campaign._id,
              adsetId:
                lead.adset_id ||
                campaign.facebookAdSetId ||
                campaign.instaAdSetId ||
                null,
              adId: lead.ad_id || campaign.mainAdId || null,
              pageId: business.pageId || null,
              leadgenId: lead.id,
              formId: form.formId,
              createdTime: lead.created_time,
              leadSource: "META",
              leadStatus: "NEW",
              ...contact,
            },
          },
          upsert: true,
        },
      });
      result.created += 1;
      if (isRecent(lead.created_time)) recentlyCreated += 1;
    }

    if (writes.length) {
      await leadModel.bulkWrite(writes, { ordered: false });
    }
  }

  // Only genuinely new leads are worth a push. A first sync can legitimately
  // import months of history, and "You have 214 new leads" at midnight for
  // leads from March helps nobody.
  if (recentlyCreated > 0) {
    await announceNewLeads(business, recentlyCreated);
  }

  return result;
}

/** Within the last day — the window that makes a lead worth notifying about. */
const RECENT_LEAD_MS = 24 * 60 * 60 * 1000;

function isRecent(createdTime) {
  if (!createdTime) return false;
  const date = new Date(createdTime);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= RECENT_LEAD_MS;
}

/** Push notification + the socket event the app listens on for a live badge. */
async function announceNewLeads(business, count) {
  try {
    if (business.userId) {
      await sendLeadNotification({
        userId: business.userId,
        businessId: business._id,
        count,
      });
    }
  } catch (error) {
    console.warn("[leadSync] notification failed:", error.message);
  }

  try {
    if (global.io) {
      global.io.to(`business:${String(business._id)}`).emit("newLead", {
        count,
        businessId: String(business._id),
        message: `${count} new lead(s) received`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.warn("[leadSync] socket emit failed:", error.message);
  }
}

/**
 * Catch-up pass across every business that has lead forms.
 * Businesses are processed a few at a time to stay well inside Meta's limits.
 */
async function syncLeadsForAllBusinesses({ sinceUnix = null } = {}) {
  const businessIds = await leadFormModel.distinct("businessId");
  const summary = { businesses: businessIds.length, created: 0, updated: 0 };

  const concurrency = 3;
  for (let i = 0; i < businessIds.length; i += concurrency) {
    const chunk = businessIds.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((id) =>
        syncLeadsForBusiness(id, { sinceUnix }).catch((error) => {
          console.warn(`[leadSync] business ${id}:`, error.message);
          return { created: 0, updated: 0 };
        }),
      ),
    );
    for (const r of results) {
      summary.created += r.created || 0;
      summary.updated += r.updated || 0;
    }
  }

  return summary;
}

module.exports = {
  syncLeadsForBusiness,
  syncLeadsForAllBusinesses,
  SYNCABLE_STATUSES,
  __test__: { firstValue, resolveCampaignForLead, buildFormMap, isRecent },
};
