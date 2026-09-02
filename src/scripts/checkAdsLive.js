#!/usr/bin/env node
/**
 * Prints what the Ads and Leads screens will actually show, straight from the
 * running API — the fastest way to confirm a deploy really is serving live Meta
 * numbers rather than stale database ones.
 *
 *   node src/scripts/checkAdsLive.js --token <jwt> --business <businessId>
 *   node src/scripts/checkAdsLive.js --token <jwt> --business <id> --api http://localhost:8000/api
 *
 * The token is the same one the mobile app sends: log in on the phone, or take
 * it from the app's auth store. Nothing here writes anything.
 */
const axios = require("axios");

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const API = arg("api", "https://api.marketingkart.in/api");
const TOKEN = arg("token");
const BUSINESS_ID = arg("business");

if (!TOKEN || !BUSINESS_ID) {
  console.error("Usage: node src/scripts/checkAdsLive.js --token <jwt> --business <businessId>");
  process.exit(1);
}

const client = axios.create({
  baseURL: API,
  timeout: 60000,
  headers: { Authorization: `Bearer ${TOKEN}` },
});

const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const num = (n) => (Number(n) || 0).toLocaleString("en-IN");

const main = async () => {
  console.log(`\nAPI: ${API}\nBusiness: ${BUSINESS_ID}\n`);

  const { data: adsRes } = await client.get(
    "/internalCampiagn/getAllInternalCampiagnByBusinessId",
    { params: { businessId: BUSINESS_ID, refresh: 1 } },
  );
  const ads = adsRes?.data || [];
  console.log(`── ${ads.length} campaign(s) ─────────────────────────────────────`);

  for (const ad of ads) {
    console.log(
      `\n${ad.title || "(untitled)"}  [${ad.status}]${ad.hasMetaData === false ? "  ⚠ no delivery reported by Meta" : ""}`,
    );
    console.log(
      `   impressions ${num(ad.totalImpression)} · reach ${num(ad.totalReach)} · clicks ${num(ad.totalClicks)} · leads ${num(ad.totalLeads)} · spent ${money(ad.totalSpendBudget)}`,
    );
    if (ad.metaStatusReason) console.log(`   Meta says: ${ad.metaStatusReason}`);

    const { data: insightsRes } = await client.get("/getAdInsightsReport", {
      params: { internalCampaignId: ad._id, refresh: 1 },
    });
    const report = insightsRes?.data;
    if (!report) continue;

    console.log(
      `   read at ${report.insightLevel || "—"} level · CTR ${report.kpi.ctr}% · CPC ₹${report.kpi.cpc} · CPM ₹${report.kpi.cpm}`,
    );
    console.log(
      `   leads: ${report.totalLeads} (Meta ${report.metaLeads}, stored ${report.dbLeads})`,
    );
    if (report.genderBreakdown?.length) {
      console.log(
        `   gender: ${report.genderBreakdown.map((g) => `${g.gender} ${g.percent}%`).join(" · ")}`,
      );
    } else {
      console.log("   gender: nothing from Meta yet");
    }
    if (report.ageBreakdown?.length) {
      console.log(
        `   age: ${report.ageBreakdown.map((a) => `${a.label} ${num(a.value)}`).join(" · ")}`,
      );
    }
    if (report.platformBreakdown?.length) {
      console.log(
        `   placement: ${report.platformBreakdown.map((p) => `${p.platform} ${p.percent}%`).join(" · ")}`,
      );
    }
    console.log(`   daily rows: ${report.dailyTrend?.length || 0}`);
  }

  console.log("\n── leads ─────────────────────────────────────────────────");
  const { data: syncRes } = await client.get("/leads/syncNow", {
    params: { businessId: BUSINESS_ID },
  });
  console.log(`sync: ${syncRes?.message} ${JSON.stringify(syncRes?.data || {})}`);

  const { data: leadsRes } = await client.get("/getLeadOfYourBussinessByMemberId", {
    params: { businessId: BUSINESS_ID },
  });
  const leads = leadsRes?.data || [];
  console.log(`${leadsRes?.totalCount ?? leads.length} lead(s) for this business`);
  for (const lead of leads.slice(0, 10)) {
    console.log(
      `   ${lead.name || "(no name)"} · ${lead.userContactNumber || "no number"} · ${lead.leadStatus} · from "${lead.adName || "—"}"`,
    );
  }
  const missingNumbers = leads.filter((l) => !l.userContactNumber && !l.whatsappNumber).length;
  if (missingNumbers) {
    console.log(`   ⚠ ${missingNumbers} lead(s) have no phone number stored`);
  }
  console.log("");
};

main().catch((error) => {
  console.error(
    "\nFailed:",
    error.response?.status,
    error.response?.data?.message || error.message,
    "\n",
  );
  process.exit(1);
});
