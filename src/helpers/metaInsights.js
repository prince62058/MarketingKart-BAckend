const axios = require("axios");
const ExternalCampaignsModel = require("../models/ExternalCampaignsModel");

const GRAPH = "https://graph.facebook.com/v22.0";

/** The 18% we add on top of what Meta bills, same as everywhere else. */
const META_GST = 1.18;

/**
 * One place that reads real numbers out of Meta for a campaign.
 *
 * Every screen that shows ad performance used to build its own Graph URL, pick
 * its own field list and parse `actions` its own way, which is how the ads list
 * and the ad detail screen ended up disagreeing about the same campaign. They
 * all come through here now, so a fix to attribution or to GST lands
 * everywhere at once.
 */

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const int = (value) => Math.round(num(value));

/** Spend as the advertiser is charged: Meta's number plus GST. */
const withGst = (spend) => Math.ceil(num(spend) * META_GST);

/**
 * Meta reports one row per action_type, and the same conversion shows up under
 * several of them (`lead`, `onsite_conversion.lead`, `lead_grouped`, ...).
 * Summing a group therefore counts one lead two or three times — take the
 * largest instead, which is the count Ads Manager itself shows.
 */
const LEAD_ACTIONS = [
  "leadgen.other",
  "leadgen",
  "lead",
  "lead_grouped",
  "onsite_conversion.lead",
  "onsite_conversion.lead_grouped",
  "onsite_web_lead",
  "offsite_conversion.fb_pixel_lead",
];

/** WhatsApp / Messenger / call ads report a conversation, never a "lead". */
const CONVERSATION_ACTIONS = [
  "onsite_conversion.messaging_first_reply",
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
  "click_to_call_call_confirm",
];

const SAVE_ACTIONS = ["post_save", "onsite_conversion.post_save"];
const REACTION_ACTIONS = ["post_reaction"];
const COMMENT_ACTIONS = ["comment"];
const SHARE_ACTIONS = ["post"];
const VIDEO_VIEW_ACTIONS = ["video_view"];
const LINK_CLICK_ACTIONS = ["link_click"];

/** Largest value across a group of interchangeable action types. */
const maxAction = (actions, types) => {
  let best = 0;
  for (const action of actions || []) {
    if (!types.includes(action.action_type)) continue;
    const value = int(action.value);
    if (value > best) best = value;
  }
  return best;
};

/** Everything we read out of one insights row's `actions` array. */
const readActions = (actions = []) => {
  const leads = maxAction(actions, LEAD_ACTIONS);
  const conversations = maxAction(actions, CONVERSATION_ACTIONS);
  return {
    leads,
    conversations,
    // What this ad is actually here to produce: a form lead for Lead ads, a
    // conversation for WhatsApp/call ads. Only one of the two is ever non-zero
    // for a given ad, so this needs no ad-type branching.
    results: leads || conversations,
    bookmarks: maxAction(actions, SAVE_ACTIONS),
    reactions: maxAction(actions, REACTION_ACTIONS),
    comments: maxAction(actions, COMMENT_ACTIONS),
    shares: maxAction(actions, SHARE_ACTIONS),
    videoViews: maxAction(actions, VIDEO_VIEW_ACTIONS),
    linkClicks: maxAction(actions, LINK_CLICK_ACTIONS),
  };
};

const accessToken = () =>
  process.env.systemUserAccessToken || process.env.admin_access_token || null;

/**
 * One insights request.
 *
 * Never throws: a campaign Meta has nothing to say about yet is normal, and one
 * failing breakdown must not take the whole report down with it. `ok` separates
 * the two cases that look identical from the outside — Meta answered and the ad
 * has no delivery (ok, empty) versus Meta refused the id (not ok) — which is
 * what decides whether it is worth asking about a different object.
 */
async function fetchRows(objectId, params, label) {
  const token = accessToken();
  if (!objectId || !token) return { ok: false, rows: [] };
  try {
    const { data } = await axios.get(`${GRAPH}/${objectId}/insights`, {
      params: { access_token: token, date_preset: "maximum", ...params },
      timeout: 20000,
    });
    return { ok: true, rows: data?.data || [] };
  } catch (error) {
    console.warn(
      `[metaInsights] ${label} failed for ${objectId}:`,
      error.response?.data?.error?.message || error.message,
    );
    return { ok: false, rows: [] };
  }
}

/**
 * Runs `fn` over `items` a few at a time.
 *
 * The ads list refreshes every campaign at once; twenty simultaneous Graph
 * calls per user is how an account walks into Meta's rate limit and gets an
 * empty list back for everything.
 */
async function mapWithConcurrency(items, fn, limit = 6) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Meta campaign ids barely change, so one small memo keeps the ads list from
// re-reading the same external campaign row for every card on every refresh.
const metaCampaignIdCache = new Map();
const META_CAMPAIGN_TTL_MS = 10 * 60 * 1000;

async function resolveMetaCampaignId(campaign) {
  const ref = campaign?.externalCampiagnId;
  if (!ref) return null;
  if (typeof ref === "object" && ref.meta_CampaignId) {
    return String(ref.meta_CampaignId);
  }

  const key = String(ref._id || ref);
  const cached = metaCampaignIdCache.get(key);
  if (cached && Date.now() - cached.at < META_CAMPAIGN_TTL_MS) return cached.id;

  try {
    const doc = await ExternalCampaignsModel.findById(key)
      .select("meta_CampaignId")
      .lean();
    const id = doc?.meta_CampaignId ? String(doc.meta_CampaignId) : null;
    metaCampaignIdCache.set(key, { id, at: Date.now() });
    return id;
  } catch (error) {
    console.warn("[metaInsights] external campaign lookup failed:", error.message);
    return null;
  }
}

/**
 * Which Meta object to ask about, best first.
 *
 * The campaign is preferred because it is the only id that survives everything
 * we do afterwards: pausing and resetting an ad replaces the ad id, and an ad
 * created without `mainAdId` persisted has no ad id at all — both of which show
 * up as a campaign that mysteriously has no numbers. One internal campaign is
 * always exactly one Meta campaign, so reading at campaign level adds nothing
 * that does not belong to this ad.
 */
async function resolveInsightTargets(campaign) {
  const targets = [];
  const metaCampaignId = await resolveMetaCampaignId(campaign);
  if (metaCampaignId) targets.push({ id: metaCampaignId, level: "campaign" });

  const adId = campaign?.mainAdId || campaign?.metaAdId;
  if (adId) targets.push({ id: String(adId), level: "ad" });

  const adsetId = campaign?.facebookAdSetId || campaign?.instaAdSetId;
  if (adsetId) targets.push({ id: String(adsetId), level: "adset" });

  // Same id can appear twice (admin-linked campaigns store the same value in
  // more than one field); asking Meta about it twice just wastes a round trip.
  const seen = new Set();
  return targets.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
}

const SUMMARY_FIELDS = [
  "reach",
  "impressions",
  "clicks",
  "unique_clicks",
  "inline_link_clicks",
  "spend",
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "actions",
].join(",");

const emptyReport = () => ({
  target: null,
  hasMetaData: false,
  kpi: {
    reach: 0,
    impressions: 0,
    clicks: 0,
    linkClicks: 0,
    uniqueClicks: 0,
    spend: 0,
    spendRaw: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    frequency: 0,
  },
  results: { leads: 0, conversations: 0, results: 0 },
  engagement: {
    bookmarks: 0,
    clicks: 0,
    reactions: 0,
    comments: 0,
    shares: 0,
    videoViews: 0,
  },
  ageBreakdown: [],
  genderBreakdown: [],
  ageGender: [],
  platformBreakdown: [],
  dailyTrend: [],
  syncedAt: new Date().toISOString(),
});

/**
 * Summary row from the first target Meta will answer for.
 *
 * An answer of "no rows" is taken at face value and ends the search — that is a
 * real ad with no delivery yet. Only an id Meta rejects moves us on to the next
 * one, which is what makes an ad whose campaign row went stale still report its
 * numbers instead of showing zeros.
 */
async function fetchSummary(targets) {
  for (const target of targets) {
    const { ok, rows } = await fetchRows(
      target.id,
      { fields: SUMMARY_FIELDS },
      `summary(${target.level})`,
    );
    if (rows[0]) return { target, row: rows[0] };
    if (ok) return { target, row: null };
  }
  return { target: targets[0] || null, row: null };
}

const percentOf = (value, total) =>
  total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0;

/** age + gender in one request; both single-axis views are derived from it. */
function foldAgeGender(rows) {
  const ageMap = new Map();
  const genderMap = new Map();
  const matrix = [];

  for (const row of rows) {
    const impressions = int(row.impressions);
    const clicks = int(row.clicks);
    const spend = withGst(row.spend);
    const { results } = readActions(row.actions);
    const age = row.age || "Unknown";
    const gender = (row.gender || "unknown").toLowerCase();

    matrix.push({ age, gender, impressions, clicks, leads: results });

    const ageEntry = ageMap.get(age) || {
      label: age,
      value: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      spend: 0,
    };
    ageEntry.impressions += impressions;
    ageEntry.value = ageEntry.impressions;
    ageEntry.clicks += clicks;
    ageEntry.leads += results;
    ageEntry.spend += spend;
    ageMap.set(age, ageEntry);

    const genderEntry = genderMap.get(gender) || {
      gender,
      value: 0,
      impressions: 0,
      clicks: 0,
      leads: 0,
      spend: 0,
      percent: 0,
    };
    genderEntry.impressions += impressions;
    genderEntry.value = genderEntry.impressions;
    genderEntry.clicks += clicks;
    genderEntry.leads += results;
    genderEntry.spend += spend;
    genderMap.set(gender, genderEntry);
  }

  // Meta hands the buckets back in whatever order it likes; the chart reads
  // wrong if 65+ lands between 18-24 and 25-34.
  const ageBreakdown = Array.from(ageMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
  const totalAgeImpressions = ageBreakdown.reduce((sum, a) => sum + a.impressions, 0);
  for (const bucket of ageBreakdown) {
    bucket.percent = percentOf(bucket.impressions, totalAgeImpressions);
  }

  const genderBreakdown = Array.from(genderMap.values());
  const totalGenderImpressions = genderBreakdown.reduce(
    (sum, g) => sum + g.impressions,
    0,
  );
  for (const bucket of genderBreakdown) {
    bucket.percent = percentOf(bucket.impressions, totalGenderImpressions);
  }
  // male, female, then whatever else Meta reported — the order the app draws.
  const genderRank = { male: 0, female: 1 };
  genderBreakdown.sort(
    (a, b) => (genderRank[a.gender] ?? 2) - (genderRank[b.gender] ?? 2),
  );

  return { ageBreakdown, genderBreakdown, ageGender: matrix };
}

function foldPlatforms(rows) {
  const totals = rows.map((row) => ({
    platform: row.publisher_platform || "unknown",
    impressions: int(row.impressions),
    clicks: int(row.clicks),
    spend: withGst(row.spend),
    leads: readActions(row.actions).results,
  }));
  const totalImpressions = totals.reduce((sum, p) => sum + p.impressions, 0);
  for (const platform of totals) {
    platform.percent = percentOf(platform.impressions, totalImpressions);
  }
  return totals.sort((a, b) => b.impressions - a.impressions);
}

/** Newest 30 days, oldest first — a chart of six months of dots is unreadable. */
const DAILY_TREND_DAYS = 30;

function foldDaily(rows) {
  return rows
    .map((row) => {
      const { results, leads, conversations } = readActions(row.actions);
      return {
        date: row.date_start || "",
        impressions: int(row.impressions),
        reach: int(row.reach),
        clicks: int(row.clicks),
        spend: withGst(row.spend),
        leads: results,
        metaLeads: leads,
        conversations,
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-DAILY_TREND_DAYS);
}

// Opening the ad detail screen fires five Graph calls. Without a short cache a
// few taps on pull-to-refresh are enough to walk into Meta's rate limit, and
// the numbers do not move faster than this anyway.
const reportCache = new Map();
const DEFAULT_CACHE_MS = 60 * 1000;

/**
 * Everything Meta knows about one campaign, normalized.
 *
 * @param {object} campaign internalCampiagnModel doc (lean is fine)
 * @param {object} options
 * @param {boolean} options.breakdowns fetch age/gender/platform/daily too
 * @param {number} options.maxAgeMs 0 to bypass the cache (pull-to-refresh)
 */
async function getCampaignInsights(campaign, options = {}) {
  const { breakdowns = true, maxAgeMs = DEFAULT_CACHE_MS } = options;
  if (!campaign) return emptyReport();

  const targets = await resolveInsightTargets(campaign);
  if (!targets.length || !accessToken()) return emptyReport();

  // Keyed by our own campaign id so a pause or a reset can drop the entry
  // without having to know which Meta object it was read from.
  const cacheKey = `${campaign._id ? String(campaign._id) : targets[0].id}:${
    breakdowns ? "full" : "kpi"
  }`;
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.report;

  const { target, row } = await fetchSummary(targets);
  const report = emptyReport();
  report.target = target;

  if (row) {
    report.hasMetaData = true;
    const actions = readActions(row.actions);
    report.kpi = {
      reach: int(row.reach),
      impressions: int(row.impressions),
      clicks: int(row.clicks),
      linkClicks: int(row.inline_link_clicks) || actions.linkClicks,
      uniqueClicks: int(row.unique_clicks),
      spend: withGst(row.spend),
      spendRaw: num(row.spend),
      ctr: Number(num(row.ctr).toFixed(2)),
      cpc: Number(num(row.cpc).toFixed(2)),
      cpm: Number(num(row.cpm).toFixed(2)),
      frequency: Number(num(row.frequency).toFixed(2)),
    };
    report.results = {
      leads: actions.leads,
      conversations: actions.conversations,
      results: actions.results,
    };
    report.engagement = {
      bookmarks: actions.bookmarks,
      // Link clicks, not every click on the ad — the two were being added
      // together, which showed more engagement clicks than there were clicks.
      clicks: report.kpi.linkClicks,
      reactions: actions.reactions,
      comments: actions.comments,
      shares: actions.shares,
      videoViews: actions.videoViews,
    };
  }

  if (breakdowns && target) {
    const [ageGenderRows, platformRows, dailyRows] = await Promise.all([
      fetchRows(
        target.id,
        {
          fields: "impressions,clicks,spend,actions",
          breakdowns: "age,gender",
        },
        "age+gender",
      ),
      fetchRows(
        target.id,
        {
          fields: "impressions,clicks,spend,actions",
          breakdowns: "publisher_platform",
        },
        "platform",
      ),
      fetchRows(
        target.id,
        {
          fields: "impressions,reach,clicks,spend,actions",
          time_increment: 1,
        },
        "daily",
      ),
    ]);

    const folded = foldAgeGender(ageGenderRows.rows);
    report.ageBreakdown = folded.ageBreakdown;
    report.genderBreakdown = folded.genderBreakdown;
    report.ageGender = folded.ageGender;
    report.platformBreakdown = foldPlatforms(platformRows.rows);
    report.dailyTrend = foldDaily(dailyRows.rows);
    if (
      !report.hasMetaData &&
      (report.ageBreakdown.length || report.dailyTrend.length)
    ) {
      report.hasMetaData = true;
    }
  }

  report.syncedAt = new Date().toISOString();
  reportCache.set(cacheKey, { report, at: Date.now() });
  return report;
}

/** Drops the cached report for a campaign, e.g. right after pausing it. */
function invalidateCampaignInsights(campaign) {
  const ids = [
    campaign?._id,
    campaign?.mainAdId,
    campaign?.metaAdId,
    campaign?.facebookAdSetId,
    campaign?.instaAdSetId,
  ]
    .filter(Boolean)
    .map(String);
  for (const key of reportCache.keys()) {
    if (ids.some((id) => key.startsWith(`${id}:`))) reportCache.delete(key);
  }
}

module.exports = {
  META_GST,
  withGst,
  mapWithConcurrency,
  readActions,
  resolveInsightTargets,
  getCampaignInsights,
  invalidateCampaignInsights,
  __test__: {
    foldAgeGender,
    foldPlatforms,
    foldDaily,
    maxAction,
    percentOf,
  },
};
