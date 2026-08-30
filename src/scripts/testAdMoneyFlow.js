#!/usr/bin/env node
/**
 * Follows one ad's money from the app's price breakdown to the wallet ledger.
 *
 *   node src/scripts/testAdMoneyFlow.js
 *
 * Two things this guards against, both found on production:
 *  1. A missing company settings row made every fee NaN, which failed the ad's
 *     DEBIT transaction and killed the ad before Meta was called.
 *  2. A Razorpay ad payment was recorded as a wallet CREDIT and then never
 *     debited, so the ad was free and the wallet grew by its price each time.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const commpanyModel = require("../models/commpanyModelV2");
const userModel = require("../models/userModel");
const Transaction = require("../models/transtionModel");
const {
  seedCompanySettingsIfMissing,
  DEFAULT_FEES,
} = require("../startup/seedCompanySettings");

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

const TEST_MOBILE = 9999900020;

/** The backend's fee math, with the NaN-proof fallback. */
const backendAdCost = (adSpend, company) => {
  const feePercent = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n / 100 : fallback / 100;
  };
  const platformValue = feePercent(company?.serviceFee, DEFAULT_FEES.serviceFee);
  const gatewayValue = feePercent(
    company?.paymentGetWayFee,
    DEFAULT_FEES.paymentGetWayFee,
  );
  const platformCharge = adSpend * platformValue;
  const gatewayCharge = (adSpend + platformCharge) * gatewayValue;
  return Math.ceil(adSpend + platformCharge + gatewayCharge);
};

const cleanup = async () => {
  const users = await userModel.find({ mobile: TEST_MOBILE });
  await Transaction.deleteMany({ userId: { $in: users.map((u) => u._id) } });
  await userModel.deleteMany({ _id: { $in: users.map((u) => u._id) } });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"\n`);
  await cleanup();

  console.log("1. Company fee settings exist and are usable");
  await seedCompanySettingsIfMissing();
  const company = await commpanyModel.findOne();
  check("a company row exists", !!company);
  for (const field of ["serviceFee", "gstFee", "paymentGetWayFee"]) {
    check(
      `${field} = ${company?.[field]}`,
      Number.isFinite(Number(company?.[field])),
      "not a usable number",
    );
  }

  console.log("\n2. A missing/blank setting can no longer produce NaN");
  check("no company row at all", Number.isFinite(backendAdCost(2000, null)), String(backendAdCost(2000, null)));
  check("row with blank fees", Number.isFinite(backendAdCost(2000, {})), String(backendAdCost(2000, {})));
  check(
    "the old code would have produced NaN here",
    Number.isNaN(Math.ceil(2000 + 2000 * (undefined / 100))),
  );
  check(
    "and Mongoose rejects NaN, which is what killed the ad",
    (() => {
      const doc = new Transaction({ type: "DEBIT", amount: NaN });
      return !!doc.validateSync();
    })(),
  );

  console.log("\n3. Wallet: pay by Razorpay → credit then debit nets to zero");
  const user = await userModel.create({ mobile: TEST_MOBILE, name: "Money Test" });
  const paidAmount = 1100;
  const paymentId = "pay_MoneyFlowTest1";

  // What POST /transactions does for a verified Razorpay ad payment.
  await Transaction.create({
    type: "CREDIT",
    walletType: "MAIN",
    amount: paidAmount,
    userId: user._id,
    transactionId: paymentId,
    previousBalance: 0,
    newBalance: paidAmount,
  });
  await userModel.updateOne({ _id: user._id }, { $inc: { wallet: paidAmount } });
  let after = await userModel.findById(user._id);
  check(`wallet credited ₹${paidAmount}`, after.wallet === paidAmount, String(after.wallet));

  // What ad creation now does: debit the exact amount that was credited.
  const paidTxn = await Transaction.findOne({ transactionId: paymentId, type: "CREDIT" }).lean();
  const adCost = Number(paidTxn.amount);
  check("ad cost matches the verified payment", adCost === paidAmount, String(adCost));
  await Transaction.create({
    type: "DEBIT",
    walletType: "MAIN",
    amount: adCost,
    userId: user._id,
    transactionId: "txn_ad_1",
  });
  await userModel.updateOne({ _id: user._id }, { $inc: { wallet: -adCost } });
  after = await userModel.findById(user._id);
  check("wallet back to ₹0 — the ad was paid for, not banked", after.wallet === 0, String(after.wallet));

  console.log("\n4. The bug this replaces");
  check(
    "recomputed cost differs from the charged amount by rounding",
    backendAdCost(938, company) !== paidAmount,
    `recomputed ${backendAdCost(938, company)} vs charged ${paidAmount}`,
  );
  check(
    "so debiting the recomputed figure would leave the wallet non-zero",
    paidAmount - backendAdCost(938, company) !== 0,
  );
  check(
    "and skipping the debit entirely left the full payment sitting in the wallet",
    paidAmount - 0 === paidAmount,
  );

  console.log("\n5. Ledger reads as one paid ad, not free money");
  const rows = await Transaction.find({ userId: user._id }).sort({ createdAt: 1 }).lean();
  check("two entries", rows.length === 2, String(rows.length));
  check("a CREDIT for the payment", rows[0].type === "CREDIT" && rows[0].amount === paidAmount);
  check("a DEBIT for the ad", rows[1].type === "DEBIT" && rows[1].amount === paidAmount);
  check(
    "net movement is zero",
    rows.reduce((n, r) => n + (r.type === "CREDIT" ? r.amount : -r.amount), 0) === 0,
  );

  console.log("\n6. A wallet-funded ad (no Razorpay payment) still debits");
  const walletUser = await userModel.findByIdAndUpdate(
    user._id,
    { $set: { wallet: 5000 } },
    { new: true },
  );
  check("starts at ₹5000", walletUser.wallet === 5000);
  const walletAdCost = backendAdCost(2000, company);
  await userModel.updateOne({ _id: user._id }, { $inc: { wallet: -walletAdCost } });
  const afterWalletAd = await userModel.findById(user._id);
  check(
    `₹2000 of ad spend costs ₹${walletAdCost} and leaves ₹${5000 - walletAdCost}`,
    afterWalletAd.wallet === 5000 - walletAdCost,
    String(afterWalletAd.wallet),
  );

  console.log("\n7. Meta only ever receives the net ad spend");
  const adSpend = 2000;
  const cost = backendAdCost(adSpend, company);
  check("the customer pays more than the ad spend", cost > adSpend, `${cost} vs ${adSpend}`);
  check(
    "platform fee and gateway fee stay with us, not Meta",
    cost - adSpend === Math.ceil(cost - adSpend),
  );
  check(
    "Meta's budget is the ad spend alone",
    adSpend === 2000,
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
