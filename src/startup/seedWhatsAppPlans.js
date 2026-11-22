const WhatsAppPlan = require("../models/whatsappPlanModel");
const { CATALOG } = require("../services/whatsappPlanCatalog");

async function disableFreeWhatsAppPlans() {
  try {
    const result = await WhatsAppPlan.updateMany(
      { $or: [{ price: 0 }, { price: { $lte: 0 } }], disable: false },
      { $set: { disable: true } }
    );
    if (result.modifiedCount > 0) {
      console.log(`✅ Disabled ${result.modifiedCount} free WhatsApp plan(s).`);
    }
  } catch (error) {
    console.error("❌ Failed to disable free WhatsApp plans:", error.message);
  }
}

async function seedWhatsAppPlansIfEmpty() {
  try {
    await disableFreeWhatsAppPlans();

    let created = 0;
    for (const plan of CATALOG) {
      const existing = await WhatsAppPlan.findOne({ code: plan.code });
      if (existing) continue;
      await WhatsAppPlan.create({ ...plan, disable: false });
      created += 1;
    }
    if (created > 0) {
      console.log(`✅ Added ${created} WhatsApp plan(s) with message credits.`);
    }

    // The older plans had a price and no included messages, so they undercut the catalog.
    const retired = await WhatsAppPlan.updateMany(
      {
        disable: false,
        code: { $nin: CATALOG.map((plan) => plan.code) },
        marketingCredits: { $in: [0, null] },
        utilityCredits: { $in: [0, null] },
        authenticationCredits: { $in: [0, null] },
      },
      { $set: { disable: true } }
    );
    if (retired.modifiedCount > 0) {
      console.log(`✅ Retired ${retired.modifiedCount} WhatsApp plan(s) that included no messages.`);
    }
  } catch (error) {
    console.error("❌ Failed to seed WhatsApp marketing plans:", error.message);
  }
}

module.exports = { seedWhatsAppPlansIfEmpty };
