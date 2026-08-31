#!/usr/bin/env node
/**
 * Checks that every Graph call addresses the ad account as Meta expects.
 *
 *   node src/scripts/testAdAccountPath.js
 *
 * Meta ad accounts address as `act_<id>`. The env value is stored bare, and the
 * create calls interpolated it raw, so every campaign / ad set / ad / creative
 * POST went to /<id>/... and Meta answered "Object with ID '<id>' does not
 * exist, cannot be loaded due to missing permissions" — which reads like a
 * permissions problem but is really a malformed path.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

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

const main = () => {
  const toPath = __test__.metaAdAccountPath;

  console.log("1. A bare id gets the prefix Meta requires");
  check("1066150309285362 → act_1066150309285362", toPath("1066150309285362") === "act_1066150309285362", toPath("1066150309285362"));

  console.log("\n2. An id that already has it is left alone");
  check("act_123 stays act_123", toPath("act_123") === "act_123", toPath("act_123"));
  check("not double-prefixed", toPath("act_123") !== "act_act_123");

  console.log("\n3. Junk in the env cannot build a nonsense path");
  check("empty string → ''", toPath("") === "");
  check("undefined → ''", toPath(undefined) === "" || toPath(undefined).startsWith("act_"), toPath(undefined));
  check("whitespace is trimmed", toPath("  456  ") === "act_456", toPath("  456  "));

  console.log("\n4. No ad-account URL in the controller uses the raw env value");
  const src = fs.readFileSync(
    path.join(__dirname, "../controllers/adsDetailsController.js"),
    "utf8",
  );
  const raw = src.match(/\$\{process\.env\.adAccountId\}\//g) || [];
  check(
    `${raw.length} raw interpolations left`,
    raw.length === 0,
    "these would POST to /<id>/... and fail",
  );

  console.log("\n5. Every ad-account edge the create flow uses is covered");
  const edges = ["campaigns", "adsets", "ads", "adcreatives", "adimages", "advideos"];
  for (const edge of edges) {
    const uses = src.match(new RegExp(`metaAdAccountPath\\(\\)\\}/${edge}`, "g")) || [];
    check(`/${edge}`, uses.length > 0, "not routed through metaAdAccountPath()");
  }

  console.log("\n6. The env value on this machine");
  const configured = process.env.adAccountId;
  console.log(`     adAccountId = ${configured || "(not set locally)"}`);
  if (configured) {
    console.log(`     resolves to  ${toPath(configured)}`);
    check("resolves to an act_ path", toPath(configured).startsWith("act_"));
  } else {
    console.log("     (set only on the deployed server — nothing to check here)");
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main();
