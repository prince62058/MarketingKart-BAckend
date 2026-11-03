// The owner decided (2026-10-26) that AI videos are never free: a new account must not start with
// credits, and the Free plan must not advertise any. New studios already start at 0 (see
// aiVideo.logic FREE_CREDITS), but a settings document saved earlier still carries the old number,
// and the app would keep handing it out.
//
// This runs exactly once, ever: the audit entry it writes is the marker. After that the admin panel
// is in charge again, so an admin who later decides to grant starting credits is not overruled at the
// next restart. Credits already sitting in customers' studios are not touched.
const { Settings, Audit } = require("../modules/aiVideo/aiVideo.settings.model");
const settingsStore = require("../modules/aiVideo/aiVideo.settings");

const MARKER = "settings.free_credits_removed";

async function removeAiVideoFreeCreditsOnce() {
  if (await Audit.exists({ action: MARKER })) return false;

  const before = await Settings.findOne({ key: "global" }).lean();
  if (before) {
    await Settings.updateOne(
      { key: "global" },
      {
        $set: {
          freeCredits: 0,
          "plans.$[free].monthlyCredits": 0,
          updatedBy: "system: no free credits",
        },
      },
      { arrayFilters: [{ "free.id": "free" }] },
    );
    settingsStore.invalidate();
  }

  await Audit.create({
    action: MARKER,
    adminName: "System",
    summary: before
      ? `Stopped giving free credits (was ${before.freeCredits ?? "the built-in default"} per new user)`
      : "Stopped giving free credits (no saved settings yet, so the built-in default of 0 applies)",
    data: { previousFreeCredits: before?.freeCredits ?? null },
  });
  console.log("AI Video: free credits for new users switched off");
  return true;
}

module.exports = { removeAiVideoFreeCreditsOnce, MARKER };
