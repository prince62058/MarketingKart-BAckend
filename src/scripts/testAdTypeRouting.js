#!/usr/bin/env node
/**
 * Verifies that every ad type routes to the right Meta objective, optimization
 * goal and destination — regardless of what _id the database gave it.
 *
 *   node src/scripts/testAdTypeRouting.js
 *
 * This is the regression guard for the bug where ad behaviour was keyed off
 * hardcoded advertisementModel _ids: after a re-seed those ids matched nothing,
 * so WhatsApp and Lead Form ads were pushed to Meta as plain REACH campaigns
 * with no destination and no lead form.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const advertisementModel = require("../models/advertisementModel");
const { seedAdTypesAndPlans } = require("../startup/seedAdTypesAndPlans");
const {
  AD_KIND,
  kindFromAdvertisementType,
  metaOutcomeFromAdvertisementType,
  resolveAdKind,
  findAdTypeIdByKind,
} = require("../helpers/adTypeHelper");
const { __test__ } = require("../controllers/adsDetailsController");

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

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"\n`);

  await seedAdTypesAndPlans();
  const types = await advertisementModel.find().lean();
  console.log(`${types.length} ad types in this database\n`);

  console.log("1. Every seeded ad type resolves to a real behaviour (no OTHER)");
  for (const t of types) {
    const kind = kindFromAdvertisementType(t.advertisementType);
    check(
      `${t.title} (${t.advertisementType}) → ${kind}`,
      kind !== AD_KIND.OTHER,
      "unmapped advertisementType",
    );
  }

  console.log("\n2. Resolution works from the database _id, whatever it is");
  for (const t of types) {
    const kind = await resolveAdKind(t._id);
    check(
      `${t.title} by _id ${t._id}`,
      kind === kindFromAdvertisementType(t.advertisementType),
      kind,
    );
  }
  const staleId = "676bd7b708acbc4f1ca6a8b6"; // the old hardcoded Lead Form id
  check(
    "a stale id from another database resolves to OTHER, not a wrong behaviour",
    (await resolveAdKind(staleId)) === AD_KIND.OTHER,
  );

  console.log("\n3. Meta campaign objectives");
  const expectedOutcome = {
    WHATSAPP_MESSAGES: "OUTCOME_ENGAGEMENT",
    LEADS: "OUTCOME_LEADS",
    CALLS: "OUTCOME_LEADS",
    WEBSITE_VISITORS: "OUTCOME_TRAFFIC",
    APP_INSTALLS: "APP_INSTALLS",
    POST_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
    VIDEO_VIEWS: "OUTCOME_AWARENESS",
    PRODUCT_CATALOG_SALES: "OUTCOME_SALES",
  };
  for (const [type, want] of Object.entries(expectedOutcome)) {
    const got = metaOutcomeFromAdvertisementType(type);
    check(`${type} → ${want}`, got === want, got);
  }

  console.log("\n4. Lead On WhatsApp builds a real click-to-WhatsApp ad set");
  const wa = __test__.resolveMetaAdSetConfig({
    adKind: AD_KIND.WHATSAPP,
    pageId: "PAGE123",
    mobileNumber: "+91 62058-72519",
  });
  check("optimization_goal CONVERSATIONS", wa.optimization_goal === "CONVERSATIONS", wa.optimization_goal);
  check("destination_type WHATSAPP", wa.destination_type === "WHATSAPP", String(wa.destination_type));
  check("page promoted", wa.promoted_object?.page_id === "PAGE123");
  check(
    "phone normalized to 916205872519",
    wa.promoted_object?.whatsapp_phone_number === "916205872519",
    wa.promoted_object?.whatsapp_phone_number,
  );

  console.log("\n5. Lead Ads attach the page_id to the ad set promoted_object");
  const lf = __test__.resolveMetaAdSetConfig({
    adKind: AD_KIND.LEAD_FORM,
    pageId: "PAGE123",
    leadFormId: "FORM456",
  });
  check("optimization_goal LEAD_GENERATION", lf.optimization_goal === "LEAD_GENERATION", lf.optimization_goal);
  check("destination_type ON_AD", lf.destination_type === "ON_AD", String(lf.destination_type));
  check("page_id attached in promoted_object", lf.promoted_object?.page_id === "PAGE123");

  console.log("\n6. The regression itself: a stale id must not produce a REACH ad");
  const stale = __test__.resolveMetaAdSetConfig({
    adKind: await resolveAdKind(staleId),
    pageId: "PAGE123",
    mobileNumber: "6205872519",
  });
  check(
    "stale id gives the inert REACH config (proving the old code's failure mode)",
    stale.optimization_goal === "REACH" && stale.promoted_object === null,
  );
  const live = await findAdTypeIdByKind(AD_KIND.WHATSAPP);
  const liveCfg = __test__.resolveMetaAdSetConfig({
    adKind: await resolveAdKind(live),
    pageId: "PAGE123",
    mobileNumber: "6205872519",
  });
  check(
    "the live WhatsApp id now gives CONVERSATIONS instead",
    liveCfg.optimization_goal === "CONVERSATIONS" && liveCfg.destination_type === "WHATSAPP",
  );

  console.log("\n7. WhatsApp CTA links");
  check("10-digit gets 91 prefix", __test__.buildWhatsAppCtaLink("6205872519") === "https://api.whatsapp.com/send?phone=916205872519");
  check("+91 form is kept as one number", __test__.buildWhatsAppCtaLink("+916205872519") === "https://api.whatsapp.com/send?phone=916205872519");
  check("spaces and dashes tolerated", __test__.buildWhatsAppCtaLink("+91 62058-72519") === "https://api.whatsapp.com/send?phone=916205872519");

  console.log("\n8. Each kind can be found back by kind (used by the lead sync)");
  for (const kind of [AD_KIND.LEAD_FORM, AD_KIND.WHATSAPP, AD_KIND.CALL, AD_KIND.TRAFFIC]) {
    const id = await findAdTypeIdByKind(kind);
    check(`${kind} → ${id}`, !!id, "no ad type configured for this kind");
  }

  await mongoose.disconnect();
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (error) => {
  console.error("\nTest run crashed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
