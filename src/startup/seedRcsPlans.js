const RcsPlan = require("../models/rcsPlanModel");

async function seedRcsPlansIfEmpty() {
  try {
    const count = await RcsPlan.countDocuments();
    if (count > 0) {
      console.log(`ℹ️ RCS plans already exist (${count} items). Skipping initial seed.`);
      return;
    }

    console.log("🌱 Seeding initial RCS marketing plans...");

    const PLANS = [
      {
        title: "Growth",
        monthlyPrice: 1499,
        annualMonthlyPrice: 1199,
        tagline: "For brands ready to send.",
        features: [
          "5 team members",
          "Contact imports and tags",
          "Campaign reports",
          "Provider connection",
        ],
        cta: "Choose Growth",
        badge: "RECOMMENDED",
        color: "#7C3AED",
        featured: true,
        teamMembers: 5,
        contactLimit: 10000,
        campaignLimit: 100,
        sortOrder: 1,
        disable: false,
      },
      {
        title: "Scale",
        monthlyPrice: 4999,
        annualMonthlyPrice: 3999,
        tagline: "More teams. Larger audiences.",
        features: [
          "20 team members",
          "Multiple sender profiles",
          "API and webhook access",
          "Priority onboarding",
        ],
        cta: "Choose Scale",
        badge: null,
        color: "#0F172A",
        featured: false,
        teamMembers: 20,
        contactLimit: 100000,
        campaignLimit: 1000,
        sortOrder: 2,
        disable: false,
      },
    ];

    await RcsPlan.insertMany(PLANS);
    console.log(`✅ Seeded ${PLANS.length} initial RCS marketing plans.`);
  } catch (error) {
    console.error("❌ Failed to seed RCS marketing plans:", error.message);
  }
}

module.exports = { seedRcsPlansIfEmpty };
