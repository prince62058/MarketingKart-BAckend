const commpanyModel = require("../models/commpanyModelV2");

/**
 * The fee percentages every rupee of an ad payment is calculated from.
 * Kept in sync with the mobile app's DEFAULT_FEE_CONFIG.
 */
const DEFAULT_FEES = {
  serviceFee: 15,
  gstFee: 18,
  paymentGetWayFee: 2,
};

/**
 * Guarantees a company settings row exists with usable fee percentages.
 *
 * Ad creation reads `commpanyModel.findOne()` and divides by serviceFee /
 * paymentGetWayFee. With no row those become `undefined / 100` → NaN, the ad's
 * DEBIT transaction fails its Number cast, and the whole ad is rolled back as
 * DELIVERY_ERROR before Meta is ever called. An empty database therefore made
 * every single ad fail, which is exactly what happened after the last reset.
 */
async function seedCompanySettingsIfMissing() {
  try {
    const existing = await commpanyModel.findOne();

    if (!existing) {
      await commpanyModel.create({
        name: "MarketingKart.ai",
        ...DEFAULT_FEES,
      });
      console.log("✅ Seeded company settings with default fee percentages");
      return;
    }

    // A row that exists but is missing a fee is just as fatal as no row.
    const patch = {};
    for (const [field, value] of Object.entries(DEFAULT_FEES)) {
      if (!Number.isFinite(Number(existing[field]))) {
        patch[field] = value;
      }
    }
    if (Object.keys(patch).length) {
      await commpanyModel.updateOne({ _id: existing._id }, { $set: patch });
      console.log(
        `✅ Backfilled missing company fee settings: ${Object.keys(patch).join(", ")}`,
      );
    }
  } catch (error) {
    console.error("❌ Failed to seed company settings:", error.message);
  }
}

module.exports = { seedCompanySettingsIfMissing, DEFAULT_FEES };
