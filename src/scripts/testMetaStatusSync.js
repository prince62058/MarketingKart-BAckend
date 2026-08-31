#!/usr/bin/env node
/**
 * Verifies that an ad's status in our apps follows Meta's own reading of it.
 *
 *   node src/scripts/testMetaStatusSync.js
 *
 * Meta's effective_status already rolls the campaign and ad set up into the ad,
 * so a paused ad set has to surface as paused rather than the ad looking live —
 * and a disapproved ad has to read as rejected, not as our own delivery error.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const internalCampaignModel = require("../models/internalCampiagnModel");
const {
  META_STATUS_MAP,
  syncCampaignStatuses,
  applyStatusToDocs,
} = require("../helpers/metaStatusHelper");

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

const TEST_TITLE = "__meta_status_sync_test__";

const cleanup = () => internalCampaignModel.deleteMany({ title: TEST_TITLE });

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"\n`);
  await cleanup();

  console.log("1. Every status Meta can report on an ad is mapped");
  // The complete effective_status set for an ad on Graph v22.0.
  const META_STATUSES = [
    "ACTIVE",
    "PAUSED",
    "DELETED",
    "ARCHIVED",
    "IN_PROCESS",
    "WITH_ISSUES",
    "CAMPAIGN_PAUSED",
    "ADSET_PAUSED",
    "PENDING_REVIEW",
    "DISAPPROVED",
    "PREAPPROVED",
    "PENDING_BILLING_INFO",
  ];
  for (const meta of META_STATUSES) {
    check(`${meta} → ${META_STATUS_MAP[meta]}`, !!META_STATUS_MAP[meta], "unmapped");
  }

  console.log("\n2. The states the advertiser actually cares about");
  check("under review shows as In Review", META_STATUS_MAP.PENDING_REVIEW === "IN_REVIEW");
  check("running shows as Active", META_STATUS_MAP.ACTIVE === "ACTIVE");
  check("finished shows as Completed", META_STATUS_MAP.ARCHIVED === "COMPLETED");
  check(
    "turned down by Meta shows as Rejected, not Delivery Error",
    META_STATUS_MAP.DISAPPROVED === "REJECTED",
    META_STATUS_MAP.DISAPPROVED,
  );
  check(
    "a technical problem stays Delivery Error",
    META_STATUS_MAP.WITH_ISSUES === "DELIVERY_ERROR",
  );

  console.log("\n3. A paused parent surfaces as paused on the ad");
  check("ad set paused", META_STATUS_MAP.ADSET_PAUSED === "PAUSED");
  check("campaign paused", META_STATUS_MAP.CAMPAIGN_PAUSED === "PAUSED");

  console.log("\n4. Waiting-to-start states read as Preparing, not Active");
  for (const meta of ["IN_PROCESS", "PREAPPROVED", "PENDING_BILLING_INFO"]) {
    check(`${meta} → Preparing`, META_STATUS_MAP[meta] === "PREPARING");
  }

  console.log("\n5. REJECTED is a status the database will accept");
  const campaign = await internalCampaignModel.create({
    title: TEST_TITLE,
    status: "IN_REVIEW",
  });
  await internalCampaignModel.updateOne(
    { _id: campaign._id },
    {
      $set: {
        status: "REJECTED",
        metaEffectiveStatus: "DISAPPROVED",
        metaStatusReason: "Your ad may not promote misleading claims.",
      },
    },
  );
  const stored = await internalCampaignModel.findById(campaign._id).lean();
  check("status persisted", stored.status === "REJECTED", stored.status);
  check("raw Meta status kept for support", stored.metaEffectiveStatus === "DISAPPROVED");
  check("Meta's reason kept", !!stored.metaStatusReason, "no reason stored");

  console.log("\n6. Campaigns with nothing on Meta are skipped, not blanked");
  const noMetaId = await internalCampaignModel.create({
    title: TEST_TITLE,
    status: "IN_REVIEW",
  });
  const results = await syncCampaignStatuses([noMetaId]);
  check("no Meta id → no sync attempted", results.size === 0, String(results.size));
  const untouched = await internalCampaignModel.findById(noMetaId._id).lean();
  check("status left alone", untouched.status === "IN_REVIEW", untouched.status);

  console.log("\n7. Finished campaigns are not resurrected by a stale Meta read");
  const done = await internalCampaignModel.create({
    title: TEST_TITLE,
    status: "COMPLETED",
    mainAdId: "1234567890",
  });
  const doneResults = await syncCampaignStatuses([done]);
  check("COMPLETED is treated as terminal", doneResults.size === 0, String(doneResults.size));

  console.log("\n8. Sync results are applied onto the docs being serialized");
  const doc = { _id: campaign._id, status: "IN_REVIEW", _doc: { status: "IN_REVIEW" } };
  applyStatusToDocs(
    [doc],
    new Map([[String(campaign._id), { status: "ACTIVE", metaEffectiveStatus: "ACTIVE" }]]),
  );
  check("plain field updated", doc.status === "ACTIVE", doc.status);
  check("mongoose _doc updated too", doc._doc.status === "ACTIVE", doc._doc.status);

  await cleanup();
  await mongoose.disconnect();
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (error) => {
  console.error("\nTest run crashed:", error);
  await cleanup().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
