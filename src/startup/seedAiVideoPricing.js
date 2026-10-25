// Puts the AI Video price list worked out in src/scripts/aiVideoPricing.js (HeyGen cost + 30% profit
// after GST and the Razorpay fee) into the database the first time the server starts after it was
// added, so the app shows those prices without anyone typing them in.
//
// It only ever INSERTS. If an admin has saved AI Video settings (even once), their numbers stay
// exactly as they are and nothing here runs again. Change prices later on the admin panel's
// "Settings & Pricing" page, or re-run the calculator when HeyGen's price or the dollar rate moves.
const { Settings, Audit } = require("../modules/aiVideo/aiVideo.settings.model");
const settingsStore = require("../modules/aiVideo/aiVideo.settings");
const { computePricing } = require("../scripts/aiVideoPricing");

async function seedAiVideoPricingIfMissing() {
  const { settings: preset } = computePricing();
  let created;
  try {
    const result = await Settings.updateOne(
      { key: "global" },
      { $setOnInsert: { key: "global", ...preset, updatedBy: "system: 30% profit price list" } },
      { upsert: true },
    );
    created = result.upsertedCount > 0;
  } catch (error) {
    // Two servers starting at the same moment: the other one inserted first.
    if (error && error.code === 11000) created = false;
    else throw error;
  }

  if (!created) {
    console.log("AI Video pricing: settings already saved by an admin, left untouched");
    return false;
  }
  settingsStore.invalidate();
  await Audit.create({
    action: "settings.seed",
    adminName: "System",
    summary: `Started with the 30% profit price list: ${preset.videoCost} credits per video, packs ${preset.packs.map(pack => `${pack.credits} for Rs ${pack.price}`).join(", ")}`,
    data: preset,
  });
  console.log("AI Video pricing: saved the 30% profit price list as the starting settings");
  return true;
}

module.exports = { seedAiVideoPricingIfMissing };
