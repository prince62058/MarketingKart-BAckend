const WhatsAppPlan = require("../models/whatsappPlanModel");

async function seedWhatsAppPlansIfEmpty() {
  try {
    const count = await WhatsAppPlan.countDocuments();
    if (count > 0) {
      console.log(`ℹ️ WhatsApp plans already exist (${count} items). Skipping initial seed.`);
      return;
    }

    console.log("🌱 Seeding initial WhatsApp marketing plans matching LeadKart reference...");

    const PLANS = [
      {
        title: "Free Trial",
        price: 0,
        duration: 7,
        contactLimit: 50,
        campaignLimit: 2,
        templateLimit: 2,
        features: ["Basic Support", "Direct WhatsApp Messaging", "Sample Templates"],
        badge: "TRIAL",
        color: "#f59e0b",
        sortOrder: 1,
        disable: false,
      },
      {
        title: "Growth Plan",
        price: 999,
        duration: 30,
        contactLimit: 2000,
        campaignLimit: 20,
        templateLimit: 10,
        features: ["Standard Support", "Bulk Messaging", "2000 Contacts", "Analytics"],
        badge: "POPULAR",
        color: "#8b5cf6",
        sortOrder: 2,
        disable: false,
      },
      {
        title: "Enterprise Plan",
        price: 1999,
        duration: 30,
        contactLimit: 10000,
        campaignLimit: 100,
        templateLimit: 50,
        features: ["Premium Priority Support", "Unlimited Campaigns", "10,000 Contacts", "Dedicated Account Manager"],
        badge: "BEST VALUE",
        color: "#eab308",
        sortOrder: 3,
        disable: false,
      },
    ];

    await WhatsAppPlan.insertMany(PLANS);
    console.log(`✅ Seeded ${PLANS.length} initial WhatsApp marketing plans.`);
  } catch (error) {
    console.error("❌ Failed to seed WhatsApp marketing plans:", error.message);
  }
}

module.exports = { seedWhatsAppPlansIfEmpty };
