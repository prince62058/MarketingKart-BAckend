const mongoose = require("mongoose");
const admin = require("firebase-admin");
const path = require("path");
require("dotenv").config();

// 1. Initialize Firebase Admin
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT === "string" && process.env.FIREBASE_SERVICE_ACCOUNT.startsWith("{")
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : require(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = require("./src/config/firebase.json");
  }
} catch (err) {
  console.error("❌ Firebase service account error:", err.message);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const MONGO_URI = process.env.DB_URL || "mongodb+srv://ayotrix1_db_user:Ayotrix5252@cluster0.b6jfh2o.mongodb.net/Leadkart?appName=Cluster0";

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB.");

  const db = mongoose.connection.db;
  const users = await db.collection("usermodels").find({
    $or: [
      { fcm: { $exists: true, $ne: "" } },
      { "fcm.0": { $exists: true } },
    ]
  }).toArray();

  console.log(`\nFound ${users.length} user(s) with registered FCM tokens.`);

  const allTokens = [];
  users.forEach((u) => {
    if (Array.isArray(u.fcm)) {
      u.fcm.forEach((t) => t && allTokens.push({ user: u.name || u.mobile || u.email, token: t }));
    } else if (typeof u.fcm === "string" && u.fcm.trim()) {
      allTokens.push({ user: u.name || u.mobile || u.email, token: u.fcm });
    }
  });

  if (allTokens.length === 0) {
    console.log("\n⚠️ No device FCM tokens registered in database yet.");
    console.log("ℹ️ To register a device token:");
    console.log("  1. Open the MarketingKart App on an Android device or emulator.");
    console.log("  2. Log in or open the Home Screen.");
    console.log("  3. The app will automatically sync the FCM token to /api/user/updateFcm.");
    console.log("  4. Re-run this test script to send a live push notification.");
    process.exit(0);
  }

  console.log(`\nFound ${allTokens.length} active device token(s). Sending test notifications...\n`);

  for (const item of allTokens) {
    try {
      console.log(`Sending to: ${item.user} (${item.token.slice(0, 20)}...)...`);
      const res = await admin.messaging().send({
        token: item.token,
        notification: {
          title: "🎉 MarketingKart Test Notification",
          body: "Your push notifications are configured and working perfectly!",
        },
        android: {
          notification: {
            channelId: "alerts",
            priority: "high",
            sound: "default",
          },
        },
        data: {
          type: "TEST_NOTIFICATION",
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`✅ Sent successfully! Message ID: ${res}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${item.user}:`, err.message);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
