#!/usr/bin/env node
/**
 * Checks how raw Meta insights rows are turned into the numbers the app draws.
 *
 *   node src/scripts/testMetaInsights.js
 *
 * No database and no Meta credentials: the rows below are real Graph API shapes
 * (age/gender breakdown, publisher_platform breakdown, time_increment=1 rows),
 * so this is the regression guard for the two ways these numbers went wrong —
 * one lead being counted three times because it appears under `lead`,
 * `onsite_conversion.lead` and `lead_grouped`, and link clicks being added on
 * top of total clicks in the engagement row.
 */
// dotenv only so the controller's own imports (Razorpay, Cloudinary) can
// construct themselves — nothing here touches the database or Meta.
require("dotenv").config();
const { readActions, withGst, __test__ } = require("../helpers/metaInsights");
const { foldAgeGender, foldPlatforms, foldDaily, maxAction, percentOf } = __test__;

let passed = 0;
let failed = 0;
const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

console.log("\n── actions ───────────────────────────────────────────────");

const leadActions = [
  { action_type: "lead", value: "7" },
  { action_type: "onsite_conversion.lead", value: "7" },
  { action_type: "lead_grouped", value: "7" },
  { action_type: "link_click", value: "42" },
  { action_type: "post_reaction", value: "13" },
  { action_type: "post_save", value: "2" },
];
const lead = readActions(leadActions);
check("one lead reported three ways stays one lead", lead.leads === 7, `got ${lead.leads}`);
check("link clicks are read separately", lead.linkClicks === 42, `got ${lead.linkClicks}`);
check("reactions come from post_reaction", lead.reactions === 13);
check("bookmarks come from post_save", lead.bookmarks === 2);
check("results falls back to leads", lead.results === 7);

const whatsappActions = [
  { action_type: "onsite_conversion.messaging_first_reply", value: "5" },
  { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "9" },
];
const chat = readActions(whatsappActions);
check("a WhatsApp ad reports conversations, not leads", chat.leads === 0 && chat.conversations === 9);
check("results uses conversations when there are no leads", chat.results === 9);
check("no actions is zero, not NaN", readActions().results === 0);
check("unknown action types are ignored", maxAction([{ action_type: "x", value: "9" }], ["lead"]) === 0);

console.log("\n── spend ─────────────────────────────────────────────────");
check("GST is added on top of Meta's spend", withGst("100") === 118, `got ${withGst("100")}`);
check("a missing spend is zero", withGst(undefined) === 0);
check("fractions round up to the paisa above", withGst("10.51") === 13, `got ${withGst("10.51")}`);

console.log("\n── age + gender ──────────────────────────────────────────");
const ageGenderRows = [
  { age: "25-34", gender: "male", impressions: "300", clicks: "20", spend: "50", actions: [{ action_type: "lead", value: "3" }] },
  { age: "25-34", gender: "female", impressions: "200", clicks: "15", spend: "40", actions: [{ action_type: "lead", value: "2" }] },
  { age: "18-24", gender: "male", impressions: "100", clicks: "5", spend: "10", actions: [] },
  { age: "65+", gender: "female", impressions: "400", clicks: "10", spend: "20", actions: [] },
];
const folded = foldAgeGender(ageGenderRows);
const ages = folded.ageBreakdown.map((a) => a.label);
check("age buckets come back in human order", JSON.stringify(ages) === JSON.stringify(["18-24", "25-34", "65+"]), ages.join(","));
check("both genders of a bucket are summed", folded.ageBreakdown.find((a) => a.label === "25-34").value === 500);
check("leads roll up per age bucket", folded.ageBreakdown.find((a) => a.label === "25-34").leads === 5);

const male = folded.genderBreakdown.find((g) => g.gender === "male");
const female = folded.genderBreakdown.find((g) => g.gender === "female");
check("male impressions are summed across ages", male.value === 400, `got ${male.value}`);
check("female impressions are summed across ages", female.value === 600, `got ${female.value}`);
check("gender percentages are of the gender total", male.percent === 40 && female.percent === 60, `${male.percent}/${female.percent}`);
check("male is listed before female", folded.genderBreakdown[0].gender === "male");
check("the age × gender matrix is kept", folded.ageGender.length === 4);
check("an empty breakdown does not divide by zero", foldAgeGender([]).genderBreakdown.length === 0);
check("percentOf(0 of 0) is 0", percentOf(0, 0) === 0);

console.log("\n── placements ────────────────────────────────────────────");
const platforms = foldPlatforms([
  { publisher_platform: "facebook", impressions: "700", clicks: "30", spend: "60", actions: [] },
  { publisher_platform: "instagram", impressions: "300", clicks: "20", spend: "40", actions: [] },
]);
check("placements are ordered by delivery", platforms[0].platform === "facebook");
check("placement share is a percentage", platforms[1].percent === 30, `got ${platforms[1].percent}`);
check("placement spend carries GST", platforms[1].spend === 48, `got ${platforms[1].spend}`);

console.log("\n── daily trend ───────────────────────────────────────────");
const daily = foldDaily([
  { date_start: "2026-08-03", impressions: "50", clicks: "3", spend: "10", reach: "45", actions: [{ action_type: "lead", value: "1" }] },
  { date_start: "2026-08-01", impressions: "10", clicks: "1", spend: "4", reach: "9", actions: [] },
  { date_start: "2026-08-02", impressions: "30", clicks: "2", spend: "7", reach: "28", actions: [] },
]);
check("days come back oldest first", daily.map((d) => d.date).join(",") === "2026-08-01,2026-08-02,2026-08-03");
check("daily leads are read from actions", daily[2].leads === 1);
check("daily spend carries GST", daily[0].spend === 5, `got ${daily[0].spend}`);

const longRun = Array.from({ length: 45 }, (_, i) => ({
  date_start: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
  impressions: "1",
  clicks: "0",
  spend: "0",
  actions: [],
}));
check("a long campaign is trimmed to the last 30 days", foldDaily(longRun).length === 30);

console.log("\n── the report the app draws ───────────────────────────────");
const { buildAdInsightsReport, campaignLeadMatch, leadDayKey } =
  require("../controllers/adsDetailsController").__test__;

const emptyInsights = {
  hasMetaData: false,
  target: null,
  kpi: { reach: 0, impressions: 0, clicks: 0, linkClicks: 0, spend: 0, ctr: 0, cpc: 0, cpm: 0, frequency: 0 },
  results: { leads: 0, conversations: 0, results: 0 },
  engagement: { bookmarks: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, videoViews: 0 },
  ageBreakdown: [],
  genderBreakdown: [],
  platformBreakdown: [],
  dailyTrend: [],
  syncedAt: "2026-09-02T10:00:00.000Z",
};

const storedCampaign = {
  _id: "camp1",
  totalReach: 900,
  totalImpression: 1200,
  totalClicks: 40,
  spendAmount: 500,
  totalLeads: 3,
};

const offline = buildAdInsightsReport({
  campaign: storedCampaign,
  insights: emptyInsights,
  leadDocs: [],
});
check("a Meta hiccup never blanks a running ad", offline.kpi.impressions === 1200 && offline.kpi.spend === 500);
check("hasMetaData stays false so the app shows an empty state", offline.hasMetaData === false);
check("stored leads still count when Meta says nothing", offline.totalLeads === 3);

const liveInsights = {
  ...emptyInsights,
  hasMetaData: true,
  target: { id: "123", level: "campaign" },
  kpi: { reach: 1000, impressions: 1500, clicks: 55, linkClicks: 30, spend: 590, ctr: 3.67, cpc: 9.1, cpm: 393, frequency: 1.5 },
  results: { leads: 4, conversations: 0, results: 4 },
  dailyTrend: [
    { date: "2026-09-01", impressions: 700, clicks: 25, spend: 300, leads: 1 },
    { date: "2026-09-02", impressions: 800, clicks: 30, spend: 290, leads: 0 },
  ],
};
const leadDocs = [
  { createdTime: "2026-09-02T09:00:00+0000" },
  { createdTime: "2026-09-02T09:30:00+0000" },
  { createdAt: new Date("2026-09-01T12:00:00.000Z") },
  { createdAt: new Date("2026-09-01T13:00:00.000Z") },
  { createdAt: new Date("2026-09-01T14:00:00.000Z") },
];
const live = buildAdInsightsReport({ campaign: storedCampaign, insights: liveInsights, leadDocs });
check("live Meta numbers win over stored ones", live.kpi.impressions === 1500 && live.kpi.spend === 590);
check("the lead count is never an undercount", live.totalLeads === 5, `got ${live.totalLeads}`);
check("both sources of the lead count are reported", live.metaLeads === 4 && live.dbLeads === 5);
check("a day Meta has not counted yet uses our own leads", live.dailyTrend[1].leads === 2, `got ${live.dailyTrend[1].leads}`);
check("a day Meta counts higher keeps Meta's number", live.dailyTrend[0].leads === 3, `got ${live.dailyTrend[0].leads}`);
check("the level the numbers were read at is reported", live.insightLevel === "campaign");

// An admin top-up is stored inside the campaign's own totals, so adding it
// again on the fallback path made every refresh of a rate-limited ad report a
// bigger number than the one before.
const toppedUp = {
  ...storedCampaign,
  totalImpression: 1300, // 1200 delivered + the 100 added below
  AddAmountInsights: { totalImpression: 100, totalReach: 0, totalSpendBudget: 0, totalLeads: 0 },
};
const offlineTopUp = buildAdInsightsReport({
  campaign: toppedUp,
  insights: emptyInsights,
  leadDocs: [],
});
check("a manual top-up is not counted twice when Meta is quiet", offlineTopUp.kpi.impressions === 1300, `got ${offlineTopUp.kpi.impressions}`);
const liveTopUp = buildAdInsightsReport({ campaign: toppedUp, insights: liveInsights, leadDocs: [] });
check("a manual top-up rides on top of a live reading", liveTopUp.kpi.impressions === 1600, `got ${liveTopUp.kpi.impressions}`);

console.log("\n── lead attribution ──────────────────────────────────────");
const match = campaignLeadMatch(
  { _id: "camp1", mainAdId: "ad1", metaAdId: "ad1" },
  { mainAdId: "ad2" },
);
check("leads are claimed by campaign id", JSON.stringify(match[0]) === '{"internalCampiagnId":"camp1"}');
check("every ad id this campaign ever had is included", JSON.stringify(match[1].adId.$in) === '["ad1","ad2"]', JSON.stringify(match[1]));
check("no pageId match — that would claim the whole page's leads", !JSON.stringify(match).includes("pageId"));
check("a campaign with no ad id still matches on itself", campaignLeadMatch({ _id: "camp2" }).length === 1);
check("lead days are keyed the way Meta labels them", leadDayKey({ createdTime: "2026-09-02T09:00:00+0000" }) === "2026-09-02");
check("an unparseable date is skipped, not crashed on", leadDayKey({ createdTime: "not a date" }) === null);

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
