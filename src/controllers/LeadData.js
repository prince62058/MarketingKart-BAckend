const cron = require("node-cron");
const {
  syncLeadsForBusiness,
  syncLeadsForAllBusinesses,
} = require("../services/leadSyncService");

/**
 * Hourly catch-up for Meta Instant Form leads.
 *
 * The webhook delivers leads within seconds, so this exists only to repair the
 * cases the webhook cannot: a Page whose subscription lapsed, a restart that
 * dropped a delivery, or an ad linked after the leads were already collected.
 *
 * What it used to do — walk every form on the Page, for ACTIVE lead-form
 * campaigns only, and keep a lead only when its ad id still matched the
 * campaign's current `mainAdId` — quietly lost every lead of a paused or
 * finished campaign, and every lead of an ad that had been rebuilt. The
 * matching, the campaign states and the Meta paging now live in
 * services/leadSyncService, which the app's pull-to-refresh calls too, so both
 * paths behave identically.
 */

/** How far back an hourly run looks. Wide enough to cover a long outage. */
const LOOKBACK_DAYS = 7;

let running = false;

const runLeadSync = async () => {
  if (running) {
    console.log("[LeadData] previous lead sync still running — skipping this tick");
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    const sinceUnix = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 24 * 60 * 60;
    const summary = await syncLeadsForAllBusinesses({ sinceUnix });
    if (summary.created || summary.updated) {
      console.log(
        `[LeadData] synced ${summary.businesses} business(es): ${summary.created} new lead(s), ${summary.updated} completed — ${Date.now() - startedAt}ms`,
      );
    }
  } catch (error) {
    console.error("[LeadData] lead sync failed:", error.message);
  } finally {
    running = false;
  }
};

cron.schedule("10 * * * *", runLeadSync);

module.exports = {
  runLeadSync,
  syncLeadsForBusiness,
  syncLeadsForAllBusinesses,
};
