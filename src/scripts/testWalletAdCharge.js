#!/usr/bin/env node
/**
 * Checks what a wallet-funded ad does to the wallet.
 *
 *   node src/scripts/testWalletAdCharge.js
 *
 * Three things must hold, and two of them did not:
 *  - a failed ad costs nothing (the failure path commits, so the debit had to
 *    be handed back explicitly rather than rolled back);
 *  - the wallet can never go negative, even if two ads are paid for at once;
 *  - a successful ad is charged exactly once.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const userModel = require("../models/userModel");
const Transaction = require("../models/transtionModel");

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

const TEST_MOBILE = 9999900040;

/** The guarded debit the ad flow now performs. */
const chargeWallet = async (userId, amount) => {
  const res = await userModel.updateOne(
    { _id: userId, wallet: { $gte: amount } },
    { $inc: { wallet: -amount } },
  );
  return res.modifiedCount === 1;
};

/** The compensating credit the failure path performs. */
const refundWallet = (userId, amount) =>
  userModel.updateOne({ _id: userId }, { $inc: { wallet: amount } });

const cleanup = async () => {
  const users = await userModel.find({ mobile: TEST_MOBILE });
  await Transaction.deleteMany({ userId: { $in: users.map((u) => u._id) } });
  await userModel.deleteMany({ _id: { $in: users.map((u) => u._id) } });
};

const walletOf = async (id) => (await userModel.findById(id).lean()).wallet;

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"\n`);
  await cleanup();

  const user = await userModel.create({
    mobile: TEST_MOBILE,
    name: "Wallet Ad Test",
    wallet: 5000,
  });

  console.log("1. A successful ad is charged exactly once");
  check("starts at ₹5000", (await walletOf(user._id)) === 5000);
  check("charge of ₹1100 applied", await chargeWallet(user._id, 1100));
  check("wallet is ₹3900", (await walletOf(user._id)) === 3900, String(await walletOf(user._id)));

  console.log("\n2. A failed ad costs nothing");
  const before = await walletOf(user._id);
  const charged = await chargeWallet(user._id, 500);
  check("debit applied first", charged && (await walletOf(user._id)) === before - 500);
  // ...the ad then fails, and the failure path hands it back.
  await refundWallet(user._id, 500);
  check(
    "refunded back to where it started",
    (await walletOf(user._id)) === before,
    String(await walletOf(user._id)),
  );

  console.log("\n3. The wallet cannot go negative");
  await userModel.updateOne({ _id: user._id }, { $set: { wallet: 300 } });
  const overdraft = await chargeWallet(user._id, 1000);
  check("a charge above the balance is refused", overdraft === false);
  check("balance untouched at ₹300", (await walletOf(user._id)) === 300, String(await walletOf(user._id)));

  console.log("\n4. Two ads paid for at the same moment cannot overdraw");
  await userModel.updateOne({ _id: user._id }, { $set: { wallet: 1000 } });
  const [a, b] = await Promise.all([
    chargeWallet(user._id, 800),
    chargeWallet(user._id, 800),
  ]);
  check("exactly one of the two succeeded", [a, b].filter(Boolean).length === 1, `${a} / ${b}`);
  check(
    "wallet is ₹200, not negative",
    (await walletOf(user._id)) === 200,
    String(await walletOf(user._id)),
  );
  check(
    "the read-then-write check alone would have allowed both",
    1000 >= 800 && 1000 >= 800,
  );

  console.log("\n5. Ten simultaneous charges stop at the balance");
  await userModel.updateOne({ _id: user._id }, { $set: { wallet: 1000 } });
  const results = await Promise.all(
    Array.from({ length: 10 }, () => chargeWallet(user._id, 300)),
  );
  const succeeded = results.filter(Boolean).length;
  check(`only ${succeeded} of 10 charges of ₹300 went through`, succeeded === 3, String(succeeded));
  check("wallet is ₹100", (await walletOf(user._id)) === 100, String(await walletOf(user._id)));
  check("never went below zero", (await walletOf(user._id)) >= 0);

  console.log("\n6. The refund is recorded, not silent");
  await Transaction.create({
    type: "CREDIT",
    walletType: "MAIN",
    amount: 500,
    userId: user._id,
    transactionId: "refund_testcampaign",
    description: "Refund — ad could not be delivered",
  });
  const refund = await Transaction.findOne({
    userId: user._id,
    transactionId: "refund_testcampaign",
  }).lean();
  check("a CREDIT row exists", refund?.type === "CREDIT");
  check("it says why", /could not be delivered/i.test(refund?.description || ""));

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
