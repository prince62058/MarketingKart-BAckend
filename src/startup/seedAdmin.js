const CryptoJS = require("crypto-js");
const userModel = require("../models/userModel");

const ADMIN_ACCOUNTS = [
  { email: "admin@marketingkart.in", name: "Super Admin", mobile: 9999999999 },
  { email: "admin@marketingkart.ai", name: "MarketingKart Admin", mobile: 9999999998 },
];

async function seedAdminIfEmpty() {
  try {
    const encryptedPassword = CryptoJS.AES.encrypt("admin123", "CRYPTOKEY").toString();
    const encryptedOtp = CryptoJS.AES.encrypt("1234", "CRYPTOKEY").toString();

    for (const acc of ADMIN_ACCOUNTS) {
      await userModel.findOneAndUpdate(
        { email: acc.email },
        {
          $set: {
            password: encryptedPassword,
            otp: encryptedOtp,
            userType: "ADMIN",
            role: 2,
            disable: false,
            emailVerified: true,
            phoneVerified: true,
          },
          $setOnInsert: {
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
