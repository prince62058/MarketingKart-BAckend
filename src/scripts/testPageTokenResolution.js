#!/usr/bin/env node
/**
 * Checks the Facebook Page link against the real Graph API.
 *
 *   node src/scripts/testPageTokenResolution.js <userAccessToken> [pageId]
 *
 * A Page can link successfully and still be useless for lead ads, because the
 * token behind it is missing a permission that only matters much later — when
 * the Instant Form is created, or when a lead comes back. This proves which
 * route actually yields a Page token and which permissions are present.
 */
require("dotenv").config();
const axios = require("axios");

const GRAPH = "https://graph.facebook.com/v22.0";

const REQUIRED_PAGE_SCOPES = {
  pages_show_list: "list your Pages",
  pages_read_engagement: "read the Page",
  pages_manage_metadata: "receive leads through the webhook",
  pages_manage_ads: "create the Instant Form",
  leads_retrieval: "read your leads",
};

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
  const token = process.argv[2];
  const wantedPageId = process.argv[3];
  if (!token) {
    console.error("Usage: node src/scripts/testPageTokenResolution.js <userAccessToken> [pageId]");
    process.exit(2);
  }

  console.log("1. The token is a live user token");
  const debug = await axios
    .get(`${GRAPH}/debug_token`, {
      params: { input_token: token, access_token: token },
      timeout: 10000,
    })
    .then((r) => r.data?.data)
    .catch(() => null);
  check("debug_token readable", !!debug);
  check("valid", debug?.is_valid === true, JSON.stringify(debug?.error || {}));
  console.log(`     type=${debug?.type} expires_at=${debug?.expires_at}`);

  console.log("\n2. Permissions the Page token will inherit");
  const granted = new Set(debug?.scopes || []);
  console.log(`     granted: ${[...granted].join(", ") || "(none)"}`);
  const missing = Object.keys(REQUIRED_PAGE_SCOPES).filter((s) => !granted.has(s));
  for (const scope of Object.keys(REQUIRED_PAGE_SCOPES)) {
    check(`${scope} — ${REQUIRED_PAGE_SCOPES[scope]}`, granted.has(scope), "NOT granted");
  }

  console.log("\n3. Which route yields a Page access token");
  let directToken = null;
  let directError = null;
  if (wantedPageId) {
    await axios
      .get(`${GRAPH}/${wantedPageId}`, {
        params: { fields: "access_token,name", access_token: token },
        timeout: 10000,
      })
      .then((r) => {
        directToken = r.data?.access_token || null;
      })
      .catch((e) => {
        directError = e.response?.data?.error?.message || e.message;
      });
    console.log(
      `     direct /{pageId}?fields=access_token → ${directToken ? "token" : "no token"}${directError ? ` (${directError.slice(0, 90)})` : ""}`,
    );
  }

  const accounts = await axios
    .get(`${GRAPH}/me/accounts`, {
      params: { fields: "id,name,access_token", limit: 200, access_token: token },
      timeout: 10000,
    })
    .then((r) => r.data?.data || [])
    .catch((e) => {
      console.log("     /me/accounts failed:", e.response?.data?.error?.message || e.message);
      return [];
    });
  console.log(`     /me/accounts → ${accounts.length} page(s)`);
  for (const page of accounts) {
    console.log(`       ${page.id}  ${page.name}  token=${page.access_token ? "yes" : "no"}`);
  }

  check(
    "at least one route produces a Page token",
    !!directToken || accounts.some((p) => p.access_token),
    "neither route returned a Page token",
  );
  if (wantedPageId) {
    const match = accounts.find((p) => String(p.id) === String(wantedPageId));
    check(`the requested Page ${wantedPageId} is one the user manages`, !!match);
    check("and it comes with a token", !!match?.access_token);
    if (!directToken && match?.access_token) {
      console.log("     → the /me/accounts fallback is what makes this link work");
    }
  }

  console.log("\n4. Verdict");
  if (missing.length) {
    console.log(`  ❌ Lead ads will fail. Missing: ${missing.join(", ")}`);
    console.log("     Re-link the Page after granting these at Facebook login.");
    failed++;
  } else {
    console.log("  ✅ Every permission a Lead Form ad needs is granted");
    passed++;
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
