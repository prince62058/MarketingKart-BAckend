const axios = require("axios");
const internalCampiagnModel = require("../models/internalCampiagnModel");

const DEFAULT_INTERVAL_MS = 30 * 1000;

const META_GST = 1.18;

const META_LEAD_ACTION_TYPES = new Set([
  "lead",
  "leadgen",
  "onsite_conversion.lead",
  "onsite_conversion.lead_grouped",
  "lead_grouped",
  "onsite_web_lead",
]);

function extractMetaLeadCount(actions = []) {
  const leadAction = actions.find((a) => META_LEAD_ACTION_TYPES.has(a.action_type));
  if (leadAction) return parseInt(leadAction.value || 0, 10) || 0;

  const firstReply = actions.find(
    (a) =>
      a.action_type === "onsite_conversion.messaging_first_reply" ||
      a.action_type === "click_to_call_call_confirm",
  );
  const conversation = actions.find(
    (a) => a.action_type === "onsite_conversion.messaging_conversation_started_7d",
  );
  return Math.max(
    parseInt(firstReply?.value || 0, 10) || 0,
    parseInt(conversation?.value || 0, 10) || 0,
  );
}

/**
 * Sync Meta insights → DB for one campaign.
 * Returns updated spend (GST + AddAmount) or null if unchanged / skipped.
 */
async function syncOneCampaignSpend(campaign, token) {
  if (!campaign?.mainAdId || !token) return null;

  const [{ data }, budgetRes] = await Promise.all([
    axios.get(
      `https://graph.facebook.com/v22.0/${campaign.mainAdId}/insights`,
      {
        params: {
          access_token: token,
          date_preset: "maximum",
          fields: "spend,impressions,reach,clicks,actions",
        },
        timeout: 10000,
      },
    ),
    // Ad itself has no budget — it lives on the adset (or the campaign, for CBO).
    // Best-effort: a failure here must not block the spend sync above.
    axios
      .get(`https://graph.facebook.com/v22.0/${campaign.mainAdId}`, {
        params: {
          access_token: token,
          fields:
            "adset{daily_budget,lifetime_budget},campaign{daily_budget,lifetime_budget}",
        },
        timeout: 10000,
      })
      .catch(() => ({ data: {} })),
  ]);

  const row = data?.data?.[0];
  // Empty insights must NOT zero out real spend
  if (!row || row.spend === undefined || row.spend === null || row.spend === "") {
    return null;
  }

  const spend = parseFloat(row.spend);
  if (!Number.isFinite(spend) || spend < 0) return null;

  // Prefer adset-level budget (the common non-CBO case); fall back to the
  // campaign for campaign-budget-optimization. Meta returns these in the
  // account currency's minor unit (e.g. paise for INR) — same /100 convention
  // used when reading campaign budgets in adsDetailsController.js.
  const budgetNode =
    budgetRes.data?.adset?.daily_budget || budgetRes.data?.adset?.lifetime_budget
      ? budgetRes.data.adset
      : budgetRes.data?.campaign || {};
  const metaDailyBudget = budgetNode.daily_budget
    ? parseInt(budgetNode.daily_budget, 10) / 100
    : 0;
  const metaTotalBudget = budgetNode.lifetime_budget
    ? parseInt(budgetNode.lifetime_budget, 10) / 100
    : 0;

  const addInsights = campaign.AddAmountInsights || {};
  const addSpend = Number(addInsights.totalSpendBudget) || 0;
  const withGst = Math.ceil(spend * META_GST) + addSpend;
  const reach =
    (parseInt(row.reach || 0, 10) || 0) + (Number(addInsights.totalReach) || 0);
  const impressions =
    (parseInt(row.impressions || 0, 10) || 0) +
    (Number(addInsights.totalImpression) || 0);
  const clicks =
    (parseInt(row.clicks || 0, 10) || 0) + (Number(addInsights.totalClicks) || 0);
  const metaLeads = extractMetaLeadCount(row.actions || []);
  const leads =
    Math.max(metaLeads, Number(campaign.totalLeads) || 0) +
    (Number(addInsights.totalLeads) || 0);

  // Only ever move budget fields toward a real value Meta reported — never
  // zero out an existing budget just because this particular call didn't
  // resolve one (ended campaigns, transient API errors, etc).
  const dailyBudgetChanged =
    metaDailyBudget > 0 && metaDailyBudget !== (Number(campaign.dailyBudget) || 0);
  const totalBudgetChanged =
    metaTotalBudget > 0 && metaTotalBudget !== (Number(campaign.totalBudget) || 0);

  const unchanged =
    withGst === campaign.spendAmount &&
    reach === (Number(campaign.totalReach) || 0) &&
    impressions === (Number(campaign.totalImpression) || 0) &&
    clicks === (Number(campaign.totalClicks) || 0) &&
    leads === (Number(campaign.totalLeads) || 0) &&
    !dailyBudgetChanged &&
    !totalBudgetChanged;

  if (unchanged) {
    return withGst;
  }

  const budgetUpdate = {};
  if (dailyBudgetChanged) budgetUpdate.dailyBudget = metaDailyBudget;
  if (totalBudgetChanged) budgetUpdate.totalBudget = metaTotalBudget;

  await internalCampiagnModel.findByIdAndUpdate(campaign._id, {
    $set: {
      spendAmount: withGst,
      totalSpendBudget: withGst,
      totalImpression: impressions,
      totalReach: reach,
      totalClicks: clicks,
      totalLeads: leads,
      totalFirstReplies: Math.max(
        leads,
        Number(campaign.totalFirstReplies) || 0,
        Number(addInsights.totalFirstReplies) || 0,
      ),
      ...budgetUpdate,
      updatedAt: new Date(),
    },
  });

  return withGst;
}

/**
 * Sync all campaigns for a business (or global active set).
 */
async function syncCampaignsSpend({ businessId = null, statuses = null } = {}) {
  const token = process.env.systemUserAccessToken;
  if (!token) {
    console.warn("[liveSpendSync] systemUserAccessToken missing — skip");
    return { updated: 0, totalSpend: 0, campaigns: 0 };
  }

  const filter = {
    mainAdId: { $exists: true, $nin: [null, ""] },
  };
  if (businessId) {
    filter.businessId = businessId;
  }
  if (statuses && statuses.length) {
    filter.status = { $in: statuses };
  } else if (!businessId) {
    // Background job: keep active-ish + completed (spend still matters for wallet)
    filter.status = {
      $in: ["ACTIVE", "IN_REVIEW", "PAUSED", "PREPARING", "COMPLETED"],
    };
  }

  const campaigns = await internalCampiagnModel
    .find(filter)
    .select(
      "title mainAdId spendAmount AddAmountInsights status businessId totalReach totalImpression totalClicks totalLeads totalFirstReplies dailyBudget totalBudget",
    )
    .lean();

  let updated = 0;
  let totalSpend = 0;

  // Small concurrency to avoid Meta rate limits
  const concurrency = 5;
  for (let i = 0; i < campaigns.length; i += concurrency) {
    const chunk = campaigns.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (campaign) => {
        try {
          const spend = await syncOneCampaignSpend(campaign, token);
          if (spend != null && spend !== campaign.spendAmount) updated++;
          return spend != null ? spend : Number(campaign.spendAmount) || 0;
        } catch (error) {
          console.warn(
            `[liveSpendSync] fail ${campaign.mainAdId}:`,
            error.response?.data?.error?.message || error.message,
          );
          return Number(campaign.spendAmount) || 0;
        }
      }),
    );
    totalSpend += results.reduce((s, n) => s + (Number(n) || 0), 0);
  }

  return {
    updated,
    totalSpend,
    campaigns: campaigns.length,
  };
}

async function syncLiveSpendOnce() {
  const result = await syncCampaignsSpend();
  if (result.updated > 0) {
    console.log(
      `[liveSpendSync] updated ${result.updated}/${result.campaigns} campaigns`,
    );
  }
  return result;
}

function startLiveSpendSync(intervalMs = DEFAULT_INTERVAL_MS) {
  console.log(`[liveSpendSync] starting (every ${intervalMs / 1000}s)`);
  setTimeout(() => {
    syncLiveSpendOnce().catch((e) =>
      console.error("[liveSpendSync] error", e.message),
    );
  }, 3000);

  setInterval(() => {
    syncLiveSpendOnce().catch((e) =>
      console.error("[liveSpendSync] error", e.message),
    );
  }, intervalMs);
}

module.exports = {
  startLiveSpendSync,
  syncLiveSpendOnce,
  syncCampaignsSpend,
  syncOneCampaignSpend,
};
