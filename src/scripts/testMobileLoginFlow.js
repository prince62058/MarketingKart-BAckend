#!/usr/bin/env node
/**
 * End-to-end check of "same number = same account on every device".
 *
 *   node src/scripts/testMobileLoginFlow.js
 *
 * Drives the real controllers against the real database using throwaway
 * numbers in the 99999xxxxx range, then deletes everything it created.
 * SMS sending is stubbed out, so no real messages go anywhere.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

// Stub the SMS gateway before the controller captures its reference.
const sendOtpHelper = require("../helpers/sendOtpHelper");
sendOtpHelper.sendOtp = () => true;
sendOtpHelper.sendOtpInMail = () => true;

const controller = require("../controllers/userController");
const userModel = require("../models/userModel");
// Registered so the login flow's .populate() calls resolve; the running server
// gets these for free when it loads its routes.
require("../models/userRoleModel");
require("../models/businessModel");
const { ensureUserIndexes } = require("../startup/ensureUserIndexes");

const TEST_MOBILES = [9999900001, 9999900002, 9999900003, 9999900004];

let passed = 0;
let failed = 0;

const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

/** Minimal res double that records what the controller sent. */
const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  res.send = res.json;
  return res;
};

const call = async (handler, body) => {
  const res = mockRes();
  await handler({ body, headers: {}, query: {}, params: {} }, res);
  return res;
};

const cleanup = async () => {
  await userModel.deleteMany({ mobile: { $in: TEST_MOBILES } });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 30000,
  });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"\n`);

  await cleanup();

  console.log("1. Unique mobile index is enforced by the database");
  await ensureUserIndexes({ log: { info: () => {}, warn: () => {}, error: () => {} } });
  const indexes = await userModel.collection.indexes();
  const mobileIdx = indexes.find((i) => i.name === "mobile_unique_when_set");
  check("index exists", !!mobileIdx);
  check("index is unique", !!mobileIdx?.unique);
  check(
    "index is partial so email-only admins are exempt",
    !!mobileIdx?.partialFilterExpression,
  );

  console.log("\n2. Three devices, three input formats, one account");
  const formats = ["9999900001", "+919999900001", "09999900001"];
  const ids = [];
  for (const mobile of formats) {
    const res = await call(controller.mobileLogInV2, { mobile });
    check(`send OTP accepted for "${mobile}"`, res.statusCode === 201, JSON.stringify(res.body));
    const found = await userModel.find({ mobile: 9999900001 });
    ids.push(...found.map((u) => String(u._id)));
  }
  const uniqueIds = [...new Set(ids)];
  check(
    "all three devices resolved to the SAME account",
    uniqueIds.length === 1,
    `got ${uniqueIds.length} distinct ids: ${uniqueIds.join(", ")}`,
  );
  const countAfterThree = await userModel.countDocuments({ mobile: 9999900001 });
  check("exactly one row in the database", countAfterThree === 1, `found ${countAfterThree}`);

  console.log("\n3. Existing account's data survives a login from a new device");
  const accountId = uniqueIds[0];
  await userModel.updateOne(
    { _id: accountId },
    { $set: { name: "Existing User", wallet: 500 } },
  );
  await call(controller.mobileLogInV2, { mobile: "+91 99999-00001" });
  const afterRelogin = await userModel.findById(accountId);
  check("same _id kept", !!afterRelogin);
  check("name preserved", afterRelogin?.name === "Existing User", afterRelogin?.name);
  check("wallet preserved", afterRelogin?.wallet === 500, String(afterRelogin?.wallet));
  check(
    "still only one account for this number",
    (await userModel.countDocuments({ mobile: 9999900001 })) === 1,
  );

  console.log("\n4. OTP verification returns that same account plus a usable token");
  const sendRes = await call(controller.mobileLogInV2, { mobile: "9999900001" });
  const otpValue = sendRes.body?.data ?? sendRes.body?.result ?? sendRes.body?.Data;
  const verifyRes = await call(controller.verifyOtpV2, {
    mobile: "09999900001",
    otp: String(otpValue),
  });
  check("verify succeeded", verifyRes.statusCode === 200, JSON.stringify(verifyRes.body));
  const verified = verifyRes.body?.data ?? verifyRes.body?.result ?? verifyRes.body?.Data;
  check(
    "verify returned the ORIGINAL account id",
    String(verified?._id) === accountId,
    `${verified?._id} vs ${accountId}`,
  );
  check("profile came back with the login", verified?.name === "Existing User");
  check("phoneVerified set", verified?.phoneVerified === true);
  const decoded = jwt.verify(
    verified?.token,
    process.env.JWT_SECRET || process.env.TOKEN_KEY || "SECRETEKEY",
  );
  check(
    "token is signed for that same account",
    String(decoded.userId) === accountId && String(decoded.User) === accountId,
  );

  console.log("\n5. Wrong OTP is rejected");
  const badRes = await call(controller.verifyOtpV2, { mobile: "9999900001", otp: "0000" });
  check("rejected", badRes.statusCode === 400);

  console.log("\n6. Ten simultaneous logins (double-tap / two devices at once)");
  await Promise.all(
    Array.from({ length: 10 }, () =>
      call(controller.mobileLogInV2, { mobile: "9999900002" }),
    ),
  );
  const raceCount = await userModel.countDocuments({ mobile: 9999900002 });
  check("still exactly one account", raceCount === 1, `found ${raceCount}`);

  console.log("\n7. A genuinely new number still gets a new account");
  const before = await userModel.countDocuments({ mobile: 9999900003 });
  await call(controller.mobileLogInV2, { mobile: "9999900003" });
  const after = await userModel.countDocuments({ mobile: 9999900003 });
  check("account created", before === 0 && after === 1);
  check(
    "it is a different account from the others",
    String((await userModel.findOne({ mobile: 9999900003 }))._id) !== accountId,
  );

  console.log("\n8. Invalid numbers are rejected, not stored");
  for (const bad of ["12345", "abcdefghij", ""]) {
    const res = await call(controller.mobileLogInV2, { mobile: bad });
    check(`rejected "${bad}"`, res.statusCode === 400, JSON.stringify(res.body));
  }

  console.log("\n9. Legacy string-typed mobiles are normalized on write");
  const legacy = await userModel.create({ mobile: "+91 99999-00004 " });
  check(
    "setter canonicalized it to a number",
    legacy.mobile === 9999900004,
    String(legacy.mobile),
  );
  await userModel.deleteOne({ _id: legacy._id }).catch(() => {});

  console.log("\n10. All four OTP entry points converge on one account");
  await userModel.deleteMany({ mobile: 9999900002 });
  const entryPoints = [
    ["mobileLogIn (v1)", controller.mobileLogIn, "9999900002"],
    ["sendOtpForMobileV2", controller.sendOtpForMobileV2, "+919999900002"],
    ["mobileLogInV2", controller.mobileLogInV2, "09999900002"],
  ];
  for (const [label, handler, mobile] of entryPoints) {
    const res = await call(handler, { mobile });
    check(`${label} accepted`, res.statusCode < 400, JSON.stringify(res.body));
  }
  check(
    "one account across all entry points",
    (await userModel.countDocuments({ mobile: 9999900002 })) === 1,
  );
  // OTP issued by the v1 endpoint must be accepted by the v2 verifier: an app
  // update that switches endpoints must not strand the user's account.
  const crossSend = await call(controller.mobileLogIn, { mobile: "9999900002" });
  const crossVerify = await call(controller.verifyMobileOtpV2, {
    mobile: "+91 99999 00002",
    otp: String(crossSend.body?.data),
  });
  check(
    "v1-issued OTP verifies through the v2 endpoint",
    crossVerify.statusCode === 200,
    JSON.stringify(crossVerify.body),
  );

  console.log("\n11. Database rejects a duplicate even if code tries to insert one");
  let rejected = false;
  try {
    await userModel.collection.insertOne({ mobile: 9999900001 });
  } catch (error) {
    rejected = error.code === 11000;
  }
  check("unique index blocked the insert", rejected);

  console.log("\n12. Verifying an account that never requested an OTP fails cleanly");
  await userModel.updateOne({ mobile: 9999900003 }, { $set: { otp: null } });
  const noOtpRes = await call(controller.verifyOtpV2, {
    mobile: "9999900003",
    otp: "1234",
  });
  check(
    "400 instead of a crash",
    noOtpRes.statusCode === 400,
    `got ${noOtpRes.statusCode}`,
  );

  await cleanup();
  await mongoose.disconnect();

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (error) => {
  console.error("\nTest run crashed:", error);
  await cleanup().catch(() => {});
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
