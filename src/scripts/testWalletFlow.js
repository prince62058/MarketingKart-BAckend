#!/usr/bin/env node
/**
 * End-to-end check of the admin panel's Wallet tab: the balances it reads and
 * the "Adjust User Wallet Balance" form it posts.
 *
 *   node src/scripts/testWalletFlow.js
 *
 * Drives the real controllers against the real database with a throwaway user
 * and a throwaway admin, then deletes everything it created.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const userController = require("../controllers/userController");
const transactionController = require("../controllers/transtionController");
const userModel = require("../models/userModel");
const transactionModel = require("../models/transtionModel");
require("../models/userRoleModel");
require("../models/businessModel");

const TEST_MOBILE = 9999900010;
const ADMIN_EMAIL = "wallet-test-admin@marketingkart.test";

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

const call = async (handler, req) => {
  const res = mockRes();
  await handler({ body: {}, headers: {}, query: {}, params: {}, ...req }, res);
  return res;
};

/** Exactly what the admin panel's Adjust Wallet form posts. */
const adjustWallet = (admin, targetUserId, { amount, type, walletType, description }) =>
  call(transactionController.createTransactions, {
    user: admin,
    body: { userId: String(targetUserId), amount, type, walletType, description },
  });

/** Exactly what the Wallet tab reads its two balance cards from. */
const readWalletTab = async (user) => {
  const res = await call(userController.getByIdUserForAdmin, { user });
  return res.body?.data;
};

const cleanup = async () => {
  const users = await userModel.find({
    $or: [{ mobile: TEST_MOBILE }, { email: ADMIN_EMAIL }],
  });
  await transactionModel.deleteMany({ userId: { $in: users.map((u) => u._id) } });
  await userModel.deleteMany({ _id: { $in: users.map((u) => u._id) } });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"\n`);
  await cleanup();

  const admin = await userModel.create({
    email: ADMIN_EMAIL,
    name: "Wallet Test Admin",
    userType: "ADMIN",
    role: 2,
  });
  let target = await userModel.create({ mobile: TEST_MOBILE, name: "Wallet Test User" });

  console.log("1. A fresh user's Wallet tab reads ₹0 / ₹0");
  let tab = await readWalletTab(target);
  check("walletAmount is 0", tab?.walletAmount === 0, String(tab?.walletAmount));
  check("whatsappWallet is 0", tab?.whatsappWallet === 0, String(tab?.whatsappWallet));

  console.log("\n2. Admin credits ₹500 to the Main Ad Wallet");
  const credit = await adjustWallet(admin, target._id, {
    amount: 500,
    type: "CREDIT",
    walletType: "MAIN",
    description: "Manual top-up",
  });
  check("request succeeded", credit.statusCode === 200, JSON.stringify(credit.body));
  check("response reports the new balance", credit.body?.data?.newBalance === 500);
  check(
    "message names the admin action",
    /credited successfully by admin/i.test(credit.body?.message || ""),
    credit.body?.message,
  );

  target = await userModel.findById(target._id);
  check("user.wallet is 500 in the database", target.wallet === 500, String(target.wallet));
  check("WhatsApp wallet untouched", target.whatsappWallet === 0, String(target.whatsappWallet));

  tab = await readWalletTab(target);
  check("Wallet tab now shows ₹500", tab?.walletAmount === 500, String(tab?.walletAmount));

  console.log("\n3. The transaction is recorded with a running balance");
  const txn = await transactionModel.findOne({ userId: target._id }).sort({ createdAt: -1 });
  check("record exists", !!txn);
  check("type CREDIT", txn?.type === "CREDIT");
  check("walletType MAIN", txn?.walletType === "MAIN");
  check("amount 500", txn?.amount === 500);
  check("previousBalance 0", txn?.previousBalance === 0, String(txn?.previousBalance));
  check("newBalance 500", txn?.newBalance === 500, String(txn?.newBalance));
  check("reason saved", txn?.description === "Manual top-up", txn?.description);
  check("transactionId generated", !!txn?.transactionId);

  console.log("\n4. The Transaction tab lists it");
  const list = await call(transactionController.listTransactions, {
    user: admin,
    query: { userId: String(target._id) },
  });
  check("list succeeded", list.statusCode === 200, JSON.stringify(list.body)?.slice(0, 200));
  const docs = list.body?.data?.docs || list.body?.data?.transactions || list.body?.data;
  check("contains the credit", Array.isArray(docs) && docs.length === 1, `got ${docs?.length}`);

  console.log("\n5. WhatsApp wallet is credited independently");
  const waCredit = await adjustWallet(admin, target._id, {
    amount: 250,
    type: "CREDIT",
    walletType: "WHATSAPP",
  });
  check("request succeeded", waCredit.statusCode === 200, JSON.stringify(waCredit.body));
  target = await userModel.findById(target._id);
  check("whatsappWallet is 250", target.whatsappWallet === 250, String(target.whatsappWallet));
  check("main wallet still 500", target.wallet === 500, String(target.wallet));
  tab = await readWalletTab(target);
  check("Wallet tab shows ₹500 / ₹250", tab?.walletAmount === 500 && tab?.whatsappWallet === 250);

  console.log("\n6. Admin debits ₹200 from the Main Ad Wallet");
  const debit = await adjustWallet(admin, target._id, {
    amount: 200,
    type: "DEBIT",
    walletType: "MAIN",
  });
  check("request succeeded", debit.statusCode === 200, JSON.stringify(debit.body));
  target = await userModel.findById(target._id);
  check("wallet is 300", target.wallet === 300, String(target.wallet));

  console.log("\n7. Over-drafting is refused and changes nothing");
  const overdraft = await adjustWallet(admin, target._id, {
    amount: 99999,
    type: "DEBIT",
    walletType: "MAIN",
  });
  check("rejected with 400", overdraft.statusCode === 400, String(overdraft.statusCode));
  check(
    "explains the shortfall",
    /insufficient/i.test(overdraft.body?.message || ""),
    overdraft.body?.message,
  );
  target = await userModel.findById(target._id);
  check("wallet still 300", target.wallet === 300, String(target.wallet));
  check(
    "no phantom transaction row",
    (await transactionModel.countDocuments({ userId: target._id })) === 3,
  );

  console.log("\n8. Decimal amounts round to paise, not floating-point noise");
  await adjustWallet(admin, target._id, { amount: 0.1, type: "CREDIT", walletType: "MAIN" });
  await adjustWallet(admin, target._id, { amount: 0.2, type: "CREDIT", walletType: "MAIN" });
  target = await userModel.findById(target._id);
  check("wallet is exactly 300.3", target.wallet === 300.3, String(target.wallet));

  console.log("\n9. Invalid amounts are refused");
  for (const amount of [0, -100, "abc", null]) {
    const res = await adjustWallet(admin, target._id, {
      amount,
      type: "CREDIT",
      walletType: "MAIN",
    });
    check(`rejected ${JSON.stringify(amount)}`, res.statusCode === 400, String(res.statusCode));
  }

  console.log("\n10. A non-admin cannot credit a wallet without a real payment");
  const selfCredit = await call(transactionController.createTransactions, {
    user: target,
    body: { userId: String(target._id), amount: 10000, type: "CREDIT", walletType: "MAIN" },
  });
  check("rejected with 400", selfCredit.statusCode === 400, String(selfCredit.statusCode));
  check(
    "demands Razorpay verification",
    /razorpay|verification/i.test(selfCredit.body?.message || ""),
    selfCredit.body?.message,
  );
  target = await userModel.findById(target._id);
  check("balance unchanged", target.wallet === 300.3, String(target.wallet));

  console.log("\n11. A non-admin cannot see another user's transactions");
  const otherList = await call(transactionController.listTransactions, {
    user: target,
    query: { userId: String(admin._id) },
  });
  const otherDocs =
    otherList.body?.data?.docs || otherList.body?.data?.transactions || otherList.body?.data;
  check(
    "userId filter ignored for non-admins",
    Array.isArray(otherDocs) && otherDocs.every((d) => String(d.userId?._id || d.userId) === String(target._id)),
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
