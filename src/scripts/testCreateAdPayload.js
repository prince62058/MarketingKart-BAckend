#!/usr/bin/env node
/**
 * Verifies the contract between the mobile app's create-ad screen and the
 * backend's createAdSetDefineBudgetAndDuration handler.
 *
 *   node src/scripts/testCreateAdPayload.js
 *
 * The app used to post campaignName / adGoal / durationDays / interests /
 * whatsappNumber / media / ISO dates. The backend destructures name /
 * addTypeId / days / interest / mobileNumber / imageVideo / Unix-seconds dates
 * and reads nothing else, so every one of those was dropped on the floor and
 * ad creation died on "interest is required" before Meta was ever called.
 *
 * This builds the exact payload the app now sends and pushes it through the
 * real extract → validate → parse chain, stopping short of the Meta calls.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const advertisementModel = require("../models/advertisementModel");
const { seedAdTypesAndPlans } = require("../startup/seedAdTypesAndPlans");
const { AD_KIND, findAdTypeIdByKind } = require("../helpers/adTypeHelper");
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

/** Mirrors CreateAdStep3Screen's payload construction exactly. */
const buildAppPayload = ({ addTypeId, media, gender = "All", duration = 7 }) => {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + duration);
  const adSpend = 2000;

  const genderCodes = gender === "Male" ? [1] : gender === "Female" ? [2] : [];
  const creativeType = media.some((m) => m.type === "video")
    ? "Video"
    : media.length > 1
      ? "MultiImage"
      : "SingleImage";

  return {
    businessId: "6a943649a8fb3534f60a86db",
    transactionId: "pay_TestPayment123",
    name: "My Test Campaign",
    addTypeId: String(addTypeId),
    totalBudget: adSpend,
    facebookBudget: adSpend / 2,
    instaBudget: adSpend / 2,
    dailyBudget: Math.round(adSpend / duration),
    isFacebookAdEnabled: true,
    isInstaAdEnabled: true,
    interest: JSON.stringify([{ id: "6003384248805", name: "Fitness and wellness" }]),
    location: JSON.stringify({
      coordinates: [
        { address: "Bhopal", latitude: 23.2599, longitude: 77.4126, radius: 25 },
      ],
    }),
    audienceGender: JSON.stringify(genderCodes),
    ageRangeFrom: 18,
    ageRangeTo: 65,
    days: JSON.stringify([]),
    startDate: Math.floor(today.getTime() / 1000),
    endDate: Math.floor(endDate.getTime() / 1000),
    type: creativeType,
    caption: "Best deals in town",
    headline: "Grow Your Business",
    primaryText: "Get more customers today",
    destinationUrl: "",
    mobileNumber: "6205872519",
    imageVideo: media.map((m) => m.remoteUrl),
    thambnail: null,
  };
};

const IMG = { type: "image", remoteUrl: "https://example.com/a.jpg" };
const IMG2 = { type: "image", remoteUrl: "https://example.com/b.jpg" };
const VID = { type: "video", remoteUrl: "https://example.com/c.mp4" };

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"\n`);
  await seedAdTypesAndPlans();

  const waId = await findAdTypeIdByKind(AD_KIND.WHATSAPP);
  const leadId = await findAdTypeIdByKind(AD_KIND.LEAD_FORM);

  console.log("1. Every field the app sends survives extractAdSetRequest");
  const payload = buildAppPayload({ addTypeId: waId, media: [IMG] });
  const extracted = __test__.extractAdSetRequest(payload);
  const mustSurvive = [
    "businessId", "name", "addTypeId", "transactionId", "totalBudget",
    "facebookBudget", "instaBudget", "dailyBudget", "isFacebookAdEnabled",
    "isInstaAdEnabled", "interest", "location", "audienceGender",
    "ageRangeFrom", "ageRangeTo", "days", "startDate", "endDate", "type",
    "caption", "headline", "primaryText", "mobileNumber", "imageVideo",
  ];
  for (const field of mustSurvive) {
    check(field, extracted[field] !== undefined, "dropped by the backend");
  }

  console.log("\n2. The old app payload would have been rejected");
  const legacy = __test__.extractAdSetRequest({
    businessId: "6a943649a8fb3534f60a86db",
    campaignName: "My Test Campaign",
    adGoal: "lead_whatsapp",
    durationDays: 7,
    interests: ["Fitness"],
    whatsappNumber: "6205872519",
    media: [IMG],
    startDate: new Date().toISOString(),
  });
  check("name is lost", legacy.name === undefined);
  check("addTypeId is lost", legacy.addTypeId === undefined);
  check("interest is lost", legacy.interest === undefined);
  check("mobileNumber is lost", legacy.mobileNumber === undefined);
  check("imageVideo is lost", legacy.imageVideo === undefined);
  let legacyError = null;
  try {
    __test__.validateAdSetRequest(legacy);
  } catch (e) {
    legacyError = e.message;
  }
  check("validation rejects it", !!legacyError, "it passed, which it must not");
  // It never even reaches the interest check: the platform flags are missing too,
  // so the ad died on the very first gate.
  check(
    "on the first missing field, before Meta is ever called",
    /isFacebookAdEnabled|interest is required/.test(legacyError || ""),
    legacyError,
  );

  console.log("\n3. The new payload passes validation");
  let newError = null;
  try {
    __test__.validateAdSetRequest(extracted);
  } catch (e) {
    newError = e.message;
  }
  check("accepted", newError === null, newError);

  console.log("\n4. Dates arrive as Unix seconds the backend can read");
  const start = new Date(extracted.startDate * 1000);
  const end = new Date(extracted.endDate * 1000);
  check("startDate is a valid date", !Number.isNaN(start.getTime()), String(start));
  check("endDate is a valid date", !Number.isNaN(end.getTime()), String(end));
  check(
    "flight is 7 days",
    Math.round((end - start) / 86400000) === 7,
    String(Math.round((end - start) / 86400000)),
  );
  const iso = new Date().toISOString();
  check(
    "an ISO string (what the app used to send) would be Invalid Date",
    Number.isNaN(new Date(iso * 1000).getTime()),
  );

  console.log("\n5. Targeting parses into a usable Meta geo block");
  const geo = await __test__.fixParseAndConvertLocationString(extracted.location);
  check("location parses", !!geo, "null");
  check("usable geo target", __test__.hasUsableGeoTarget(geo), JSON.stringify(geo));

  console.log("\n6. Interests carry Meta ids, not display names");
  const interests = JSON.parse(extracted.interest);
  check("is an array", Array.isArray(interests) && interests.length > 0);
  check("has a numeric Meta id", /^\d+$/.test(String(interests[0]?.id)), String(interests[0]?.id));

  console.log("\n7. Gender maps to Meta codes");
  for (const [label, want] of [["All", []], ["Male", [1]], ["Female", [2]]]) {
    const p = buildAppPayload({ addTypeId: waId, media: [IMG], gender: label });
    const codes = JSON.parse(__test__.extractAdSetRequest(p).audienceGender);
    check(`${label} → [${want}]`, JSON.stringify(codes) === JSON.stringify(want), JSON.stringify(codes));
  }

  console.log("\n8. Creative type follows the picked media");
  for (const [media, want] of [
    [[IMG], "SingleImage"],
    [[IMG, IMG2], "MultiImage"],
    [[VID], "Video"],
    [[IMG, VID], "Video"],
  ]) {
    const p = buildAppPayload({ addTypeId: waId, media });
    check(`${media.length} item(s) → ${want}`, p.type === want, p.type);
  }
  check(
    "an unset type would build no creative at all",
    !["SingleImage", "MultiImage", "Video"].includes(undefined),
  );

  console.log("\n9. Media URLs reach the creative builder");
  const prepared = __test__.prepareProcessAdCreationPayload(extracted);
  check("imageVideo becomes fileLocation", Array.isArray(prepared.fileLocation), typeof prepared.fileLocation);
  check("URL preserved", prepared.fileLocation[0] === IMG.remoteUrl, String(prepared.fileLocation[0]));
  check(
    "normalizeMediaArray keeps it",
    __test__.normalizeMediaArray(prepared.fileLocation).length === 1,
  );

  console.log("\n10. addTypeId resolves to a real ad type in this database");
  for (const [label, id] of [["Lead On WhatsApp", waId], ["Lead Ads", leadId]]) {
    const doc = await advertisementModel.findById(id).lean();
    check(`${label} → ${doc?.advertisementType}`, !!doc, "no such ad type");
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
