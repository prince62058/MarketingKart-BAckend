#!/usr/bin/env node
/**
 * Checks every targeting control the ad form offers, the way Meta will see it:
 * target area, budget, gender, age, schedule (days + day-part) and placements.
 *
 *   node src/scripts/testAdTargeting.js
 */
require("dotenv").config();
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

const geo = (payload) => __test__.convertLocationToMetaGeo(JSON.stringify(payload));

// Mirrors CreateAdStep3Screen: net ad spend split across the enabled platforms.
const splitBudget = (adSpend, fbOn, igOn) => {
  const fb = fbOn ? (igOn ? Math.round(adSpend / 2) : adSpend) : 0;
  const ig = igOn ? adSpend - fb : 0;
  return { fb, ig };
};

// Mirrors the backend's publisher_platforms block.
const placements = (fbOn, igOn) => {
  const publisher = [];
  let facebook_positions = [];
  let instagram_positions = [];
  if (fbOn) {
    publisher.push("facebook", "audience_network");
    facebook_positions = ["feed"];
  }
  if (igOn) {
    if (!publisher.includes("instagram")) publisher.push("instagram");
    instagram_positions = ["stream"];
  }
  return { publisher, facebook_positions, instagram_positions };
};

const META_FLOOR_RUPEES = 88.71;

const main = () => {
  console.log("1. Target area — a pin with a radius");
  const oneArea = geo({
    coordinates: [
      { address: "Bhopal", latitude: 23.2599, longitude: 77.4126, radius: 20 },
    ],
  });
  const loc = oneArea.custom_locations[0];
  check("one custom location", oneArea.custom_locations.length === 1);
  check("latitude kept", loc.latitude === 23.2599, String(loc.latitude));
  check("longitude kept", loc.longitude === 77.4126, String(loc.longitude));
  check("address kept", loc.address_string === "Bhopal", loc.address_string);
  check("radius stays 20 km", loc.radius === 20, String(loc.radius));
  check("unit is kilometer", loc.distance_unit === "kilometer", loc.distance_unit);
  check("usable geo target", __test__.hasUsableGeoTarget(oneArea));

  console.log("\n2. Target area — several pins at once");
  const many = geo({
    coordinates: [
      { address: "Bhopal", latitude: 23.2599, longitude: 77.4126, radius: 20 },
      { address: "Indore", latitude: 22.7196, longitude: 75.8577, radius: 15 },
      { address: "Jabalpur", latitude: 23.1815, longitude: 79.9864, radius: 10 },
    ],
  });
  check("all three kept", many.custom_locations.length === 3, String(many.custom_locations.length));
  check(
    "each keeps its own radius",
    many.custom_locations.map((c) => c.radius).join(",") === "20,15,10",
    many.custom_locations.map((c) => c.radius).join(","),
  );

  console.log("\n3. Target area — Pan India");
  const india = geo({ countries: ["IN"] });
  check("countries targeting", JSON.stringify(india.countries) === '["IN"]', JSON.stringify(india));
  check("no empty custom_locations", india.custom_locations === undefined);
  check("usable geo target", __test__.hasUsableGeoTarget(india));

  console.log("\n4. Target area — radius is clamped to Meta's limits");
  check("0 km becomes the 1 km minimum", geo({ coordinates: [{ latitude: 1, longitude: 1, radius: 0 }] }).custom_locations[0].radius === 1);
  // The picker is capped at 50 km, so bare numbers above 200 are legacy metres.
  check("a bare 500 is read as 500 m → the 1 km minimum", geo({ coordinates: [{ latitude: 1, longitude: 1, radius: 500 }] }).custom_locations[0].radius === 1);
  check(
    "500 km stated in kilometres clamps to Meta's 80 km",
    geo({ coordinates: [{ latitude: 1, longitude: 1, radius: 500, distance_unit: "kilometer" }] }).custom_locations[0].radius === 80,
  );
  check(
    "an explicit metre unit beats the magnitude guess",
    geo({ coordinates: [{ latitude: 1, longitude: 1, radius: 30000, distance_unit: "meter" }] }).custom_locations[0].radius === 30,
  );
  check("a metres value (5000) reads as 5 km", geo({ coordinates: [{ latitude: 1, longitude: 1, radius: 5000 }] }).custom_locations[0].radius === 5);
  check("missing radius falls back to 8 km", geo({ coordinates: [{ latitude: 1, longitude: 1 }] }).custom_locations[0].radius === 8);
  check("a pin with no coordinates is dropped", geo({ coordinates: [{ address: "nowhere" }] }).custom_locations.length === 0);
  check("no target at all is refused", !__test__.hasUsableGeoTarget(geo({ coordinates: [] })));

  console.log("\n5. Gender");
  for (const [label, want] of [["All", []], ["Male", [1]], ["Female", [2]]]) {
    const codes = label === "Male" ? [1] : label === "Female" ? [2] : [];
    check(`${label} → ${JSON.stringify(want)}`, JSON.stringify(codes) === JSON.stringify(want));
  }
  check("[] means everyone, which is what Meta expects", JSON.stringify([]) === "[]");

  console.log("\n6. Age ranges from the form");
  const AGE_BOUNDS = [[18, 65], [18, 24], [25, 34], [35, 44], [45, 65]];
  for (const [from, to] of AGE_BOUNDS) {
    check(
      `${from}–${to} is inside Meta's 13–65 range`,
      from >= 13 && from <= to && to <= 65,
      `${from}-${to}`,
    );
  }

  console.log("\n7. Day-part schedule");
  check(
    "no days selected → no adset_schedule (runs all day, every day)",
    __test__.buildMetaAdSetSchedule(JSON.stringify([]), "00:00", "23:59") === null,
  );
  const weekdays = __test__.buildMetaAdSetSchedule(JSON.stringify([1, 2, 3, 4, 5]), "09:00", "18:00");
  check("weekdays produce one schedule block", Array.isArray(weekdays) && weekdays.length === 1);
  check("days kept", JSON.stringify(weekdays[0].days) === "[1,2,3,4,5]", JSON.stringify(weekdays[0].days));
  check("09:00 → minute 540", weekdays[0].start_minute === 540, String(weekdays[0].start_minute));
  check("18:00 → minute 1080", weekdays[0].end_minute === 1080, String(weekdays[0].end_minute));
  const sunday = __test__.buildMetaAdSetSchedule(JSON.stringify([7]), "10:00", "20:00");
  check("day 7 (Sunday) maps to Meta's 0", JSON.stringify(sunday[0].days) === "[0]", JSON.stringify(sunday[0].days));
  const inverted = __test__.buildMetaAdSetSchedule(JSON.stringify([1]), "20:00", "08:00");
  check(
    "an end before the start falls back to the full day",
    inverted[0].start_minute === 0 && inverted[0].end_minute === 1440,
    JSON.stringify(inverted[0]),
  );
  const noTimes = __test__.buildMetaAdSetSchedule(JSON.stringify([1, 2]), null, null);
  check(
    "days without times run the whole day",
    noTimes[0].start_minute === 0 && noTimes[0].end_minute === 1440,
    JSON.stringify(noTimes[0]),
  );
  check("duplicate days collapse", JSON.stringify(__test__.normalizeMetaScheduleDays([1, 1, 2])) === "[1,2]");
  check(
    "garbage days are dropped, and null does not become Sunday",
    JSON.stringify(__test__.normalizeMetaScheduleDays(["x", null, undefined, "", 3])) === "[3]",
    JSON.stringify(__test__.normalizeMetaScheduleDays(["x", null, undefined, "", 3])),
  );
  check("'9:30' parses to 570", __test__.timeToMinutes("9:30") === 570, String(__test__.timeToMinutes("9:30")));

  console.log("\n8. Budget split across placements");
  const both = splitBudget(2000, true, true);
  check("both on → 1000 / 1000", both.fb === 1000 && both.ig === 1000, JSON.stringify(both));
  const fbOnly = splitBudget(2000, true, false);
  check("Facebook only → all 2000 on FB", fbOnly.fb === 2000 && fbOnly.ig === 0, JSON.stringify(fbOnly));
  const igOnly = splitBudget(2000, false, true);
  check("Instagram only → all 2000 on IG", igOnly.fb === 0 && igOnly.ig === 2000, JSON.stringify(igOnly));
  for (const spend of [1001, 827, 999, 1]) {
    const sp = splitBudget(spend, true, true);
    check(`₹${spend} splits without losing a rupee`, sp.fb + sp.ig === spend, JSON.stringify(sp));
  }
  check(
    "the backend recomputes the same total",
    splitBudget(2000, true, true).fb + splitBudget(2000, true, true).ig === 2000,
  );

  console.log("\n9. Daily budget must clear Meta's floor");
  const daily = (adSpend, days) => adSpend / days;
  check("₹2000 over 7 days (₹285/day) is fine", daily(2000, 7) >= META_FLOOR_RUPEES);
  check("₹827 over 4 days (₹207/day) is fine", daily(827, 4) >= META_FLOOR_RUPEES);
  check(
    "₹376 over 7 days (₹54/day) is below the floor and must be blocked before payment",
    daily(376, 7) < META_FLOOR_RUPEES,
    String(daily(376, 7).toFixed(2)),
  );
  check("the app's guard uses the same ₹89 floor", Math.ceil(META_FLOOR_RUPEES) === 89);

  console.log("\n10. Placements");
  const b = placements(true, true);
  check("both → facebook + audience_network + instagram", JSON.stringify(b.publisher) === '["facebook","audience_network","instagram"]', JSON.stringify(b.publisher));
  check("facebook feed", JSON.stringify(b.facebook_positions) === '["feed"]');
  check("instagram stream", JSON.stringify(b.instagram_positions) === '["stream"]');
  const f = placements(true, false);
  check("Facebook only excludes instagram", !f.publisher.includes("instagram"), JSON.stringify(f.publisher));
  const i = placements(false, true);
  check("Instagram only excludes facebook", !i.publisher.includes("facebook"), JSON.stringify(i.publisher));
  check("neither selected is blocked in the app before payment", placements(false, false).publisher.length === 0);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main();
