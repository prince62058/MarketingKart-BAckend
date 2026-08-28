const CryptoJS = require("crypto-js");
const userModel = require("../models/userModel");

const ADMIN_ACCOUNTS = [
  { email: "superadmin@livechat.com", name: "Super Admin" },
  { email: "admin@marketingkart.ai", name: "MarketingKart Admin" },
  { email: "admin@marketingkart.in", name: "MarketingKart Admin IN" },
  { email: "admin@leadkart.com", name: "Leadkart Admin" },
];

async function seedAdminIfEmpty() {
  try {
    const encryptedPassword = CryptoJS.AES.encrypt("admin123", "CRYPTOKEY").toString();
    const encryptedOtp = CryptoJS.AES.encrypt("1234", "CRYPTOKEY").toString();

    for (const acc of ADMIN_ACCOUNTS) {
      await userModel.findOneAndUpdate(
        { email: acc.email },
        {
          $setOnInsert: {
            email: acc.email,
            name: acc.name,
            password: encryptedPassword,
            otp: encryptedOtp,
            userType: "ADMIN",
            role: 2,
            disable: false,
            emailVerified: true,
            phoneVerified: true,
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
