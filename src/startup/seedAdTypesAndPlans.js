const advertisementModel = require("../models/advertisementModel");
const planModel = require("../models/planModel");

/** Meta net spend after platform fees (matches planController create/update). */
function platformBudgets(price, days) {
  const netAdSpend = Math.round(Number(price) * 0.65);
  const dailySpendBudget = Math.round(netAdSpend / Number(days));
  const half = Math.round(dailySpendBudget / 2);
  return { dailySpendBudget, facebookBudget: half, instaBudget: half };
}

/**
 * Live Ad Packages catalog — Lead On WhatsApp only.
 * These four replace the old per-objective "Starter Plan" seed that wiped admin edits on every boot.
 */
const LEAD_ON_WHATSAPP = {
  type: {
    title: "Lead On WhatsApp",
    description: "Get high-intent direct customer inquiries & instant orders on WhatsApp",
    advertisementType: "WHATSAPP_MESSAGES",
    minimumBudget: 200,
    isFacebook: true,
    isInstagram: true,
    isGoogle: false,
  },
  plans: [
    {
      title: "Launch Package",
      price: 1499,
      duretion: 3,
      ...platformBudgets(1499, 3),
      views: "10k - 19k",
      reach: "15k - 20k",
      leads: "15 - 25",
      aiImageCount: 3,
    },
    {
      title: "Scale Package",
      price: 2000,
      duretion: 3,
      ...platformBudgets(2000, 3),
      views: "10k - 20k",
      reach: "20k - 30k",
      leads: "20 - 35",
      aiImageCount: 5,
    },
    {
      title: "Pro Ads",
      price: 3599,
      duretion: 5,
      ...platformBudgets(3599, 5),
      views: "30k - 57k",
      reach: "24k - 45k",
      leads: "22 - 37",
      aiImageCount: 8,
    },
    {
      title: "Dominate Package",
      price: 5999,
      duretion: 7,
      ...platformBudgets(5999, 7),
      views: "30k - 55k",
      reach: "40k - 75k",
      leads: "30 - 55",
      aiImageCount: 12,
    },
  ],
};

const CANONICAL_TITLES = LEAD_ON_WHATSAPP.plans.map((p) => p.title);

/** Old seed titles that used to recreate on every server restart. */
const LEGACY_SEED_TITLES = [
  "Starter Plan",
  "Growth Plan (Popular)",
  "Pro Business Plan",
  "Scale Enterprise Plan",
];

async function seedAdTypesAndPlans() {
  try {
    const adTypeDoc = await advertisementModel.findOneAndUpdate(
      { title: LEAD_ON_WHATSAPP.type.title },
      { $set: { ...LEAD_ON_WHATSAPP.type, disable: false } },
      { upsert: true, new: true }
    );

    const legacyCount = await planModel.countDocuments({
      title: { $in: LEGACY_SEED_TITLES },
    });
    const canonicalCount = await planModel.countDocuments({
      advertisementTypeId: adTypeDoc._id,
      title: { $in: CANONICAL_TITLES },
    });
    const otherCount = await planModel.countDocuments({
      $or: [
        { advertisementTypeId: { $ne: adTypeDoc._id } },
        {
          advertisementTypeId: adTypeDoc._id,
          title: { $nin: CANONICAL_TITLES },
        },
      ],
    });

    // Catalog already correct — do not overwrite admin edits on every boot.
    if (legacyCount === 0 && canonicalCount === CANONICAL_TITLES.length && otherCount === 0) {
      console.log(
        "ℹ️ Ad Packages catalog OK (Launch / Scale / Pro Ads / Dominate). Skipping seed."
      );
      return;
    }

    // Upsert the four packages by title (stable ids when names already exist).
    for (const p of LEAD_ON_WHATSAPP.plans) {
      await planModel.findOneAndUpdate(
        { advertisementTypeId: adTypeDoc._id, title: p.title },
        {
          $set: {
            ...p,
            advertisementTypeId: adTypeDoc._id,
            disable: false,
          },
        },
        { upsert: true, new: true }
      );
    }

    // Drop any other Lead On WhatsApp package that is not in the catalog.
    await planModel.deleteMany({
      advertisementTypeId: adTypeDoc._id,
      title: { $nin: CANONICAL_TITLES },
    });

    // Only these four packages should exist anywhere in Ad Packages.
    await planModel.deleteMany({
      advertisementTypeId: { $ne: adTypeDoc._id },
    });

    console.log(
      "✅ Ad Packages restored to Lead On WhatsApp:",
      CANONICAL_TITLES.join(", ")
    );
  } catch (error) {
    console.error("❌ Failed to seed ad types and plans:", error);
  }
}

module.exports = { seedAdTypesAndPlans, LEAD_ON_WHATSAPP };
