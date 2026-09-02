#!/usr/bin/env node
/**
 * Checks the rules that decide whether a Meta lead ever reaches the Leads tab.
 *
 *   node src/scripts/testLeadSync.js
 *
 * No database and no Meta credentials. The regression this guards: leads were
 * only kept when their `ad_id` still matched the campaign's current `mainAdId`,
 * so every lead of a rebuilt ad — and every lead of a paused or finished
 * campaign — was silently dropped.
 */
require("dotenv").config();
const { __test__ } = require("../services/leadSyncService");
const { firstValue, resolveCampaignForLead, buildFormMap, isRecent } = __test__;

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

console.log("\n── form fields ───────────────────────────────────────────");
check("a phone is found under Meta's own field name", firstValue({ phone_number: "9876543210" }, ["phone_number", "phone"]) === "9876543210");
check("surrounding whitespace is trimmed", firstValue({ full_name: "  Asha  " }, ["full_name"]) === "Asha");
check("a blank answer counts as no answer", firstValue({ email: "   " }, ["email"]) === null);
check("the first filled field wins", firstValue({ name: "Asha", full_name: "" }, ["full_name", "name"]) === "Asha");
check("a form with none of the fields is null, not undefined", firstValue({}, ["phone"]) === null);

console.log("\n── attribution ───────────────────────────────────────────");
const live = { _id: "camp-live", mainAdId: "ad-live", createdAt: "2026-08-01" };
const rebuilt = { _id: "camp-rebuilt", mainAdId: "ad-new", createdAt: "2026-08-20" };
const adIdMap = new Map([
  ["ad-live", live],
  ["ad-new", rebuilt],
]);
const form = { formId: "form1", campaign: rebuilt };

check(
  "a lead is attributed by its ad id",
  resolveCampaignForLead({ ad_id: "ad-live" }, { adIdMap, form })._id === "camp-live",
);
check(
  "a lead from an ad we no longer know falls back to the form's campaign",
  resolveCampaignForLead({ ad_id: "ad-deleted" }, { adIdMap, form })._id === "camp-rebuilt",
);
check(
  "a lead with no ad id at all still lands on the form's campaign",
  resolveCampaignForLead({}, { adIdMap, form })._id === "camp-rebuilt",
);
check(
  "a form belonging to nothing of ours is skipped, not guessed at",
  resolveCampaignForLead({ ad_id: "someone-elses-ad" }, { adIdMap, form: { formId: "x", campaign: null } }) === null,
);

console.log("\n── shared forms ──────────────────────────────────────────");
const campaignById = new Map([
  ["camp-live", live],
  ["camp-rebuilt", rebuilt],
]);
const forms = buildFormMap(
  [
    { formId: "form1", internalCampiagnId: "camp-live" },
    { formId: "form1", internalCampiagnId: "camp-rebuilt" },
    { formId: "form2", internalCampiagnId: "camp-live" },
    { formId: null, internalCampiagnId: "camp-live" },
  ],
  campaignById,
);
check("one entry per Meta form, however many campaigns share it", forms.size === 2, `got ${forms.size}`);
check("a shared form falls back to the newest campaign", forms.get("form1").campaign._id === "camp-rebuilt");
check("a form of its own keeps its own campaign", forms.get("form2").campaign._id === "camp-live");
check("a row with no form id is ignored", !forms.has("null") && !forms.has(null));
check(
  "a form whose campaign is gone still syncs, with no fallback",
  buildFormMap([{ formId: "form3", internalCampiagnId: "deleted" }], campaignById).get("form3").campaign === null,
);

console.log("\n── notification window ───────────────────────────────────");
check("a lead from a minute ago is worth a push", isRecent(new Date(Date.now() - 60 * 1000).toISOString()));
check("a lead from last March is not", isRecent("2026-03-01T10:00:00+0000") === false);
check("a missing timestamp never triggers a push", isRecent(null) === false);
check("an unparseable timestamp never triggers a push", isRecent("whenever") === false);

console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
