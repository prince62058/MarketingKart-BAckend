const userModel = require("../models/userModel");

const ADMIN_ACCOUNTS = [
  { email: "admin@marketingkart.in", name: "Super Admin", mobile: 9999999999 },
  { email: "admin@marketingkart.ai", name: "MarketingKart Admin", mobile: 9999999998 },
];

async function seedAdminIfEmpty() {
  try {
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!password) return;
    const encryptedPassword = require("../helpers/passwordHash").hashPassword(password);


    for (const acc of ADMIN_ACCOUNTS) {
      await userModel.findOneAndUpdate(
        { email: acc.email },
        {
          $setOnInsert: {
            password: encryptedPassword,
            userType: "ADMIN",
            role: 2,
            disable: false,
            emailVerified: true,
            phoneVerified: true,
            name: acc.name,
            mobile: acc.mobile,
          },
        },
        { upsert: true, new: true }
      );
    }
  } catch (error) {
    console.error("❌ Failed to auto-seed admin accounts:", error);
  }
}

module.exports = { seedAdminIfEmpty };
