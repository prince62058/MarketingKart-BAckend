#!/usr/bin/env node
/**
 * Audits — and optionally repairs — accounts that share one phone number.
 *
 *   node src/scripts/repairDuplicateMobileAccounts.js            # dry run, changes nothing
 *   node src/scripts/repairDuplicateMobileAccounts.js --apply    # merge + enforce the index
 *
 * For each duplicated number it keeps one surviving account (the one that
 * actually carries data — businesses first, then wallet/profile, then the
 * oldest) and detaches the others: their businessIds are folded into the
 * survivor, blank survivor fields are backfilled from them, and they keep every
 * field they had except `mobile`, which is cleared so the survivor owns the
 * number. Nothing is deleted, and `mergedInto` records where each one went.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const userModel = require("../models/userModel");
const {
  ensureUserIndexes,
  findDuplicateMobiles,
} = require("../startup/ensureUserIndexes");

const APPLY = process.argv.includes("--apply");

/** Higher score = more worth keeping as the surviving account. */
const score = (user) => {
  let value = 0;
  if (Array.isArray(user.businessId)) value += user.businessId.length * 1000;
  if (user.wallet) value += 100;
  if (user.whatsappWallet) value += 100;
  if (user.name) value += 10;
  if (user.email) value += 10;
  if (user.image) value += 5;
  if (user.phoneVerified) value += 5;
  return value;
};

const pickSurvivor = (users) =>
  [...users].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    // Same amount of data: keep the account the user has had the longest.
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  })[0];

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  console.log(`Connected to "${mongoose.connection.db.databaseName}"`);
  console.log(APPLY ? "Mode: APPLY (writes)" : "Mode: DRY RUN (no writes)");

  const total = await userModel.countDocuments();
  const withMobile = await userModel.countDocuments({ mobile: { $ne: null } });
  console.log(`\nAccounts: ${total} total, ${withMobile} with a mobile number`);

  // Mobiles stored as a string are invisible to the unique index and never
  // match the Number-cast login lookup, so they are duplicates waiting to
  // happen even when nothing is duplicated yet.
  const stringMobiles = await userModel.collection
    .find({ mobile: { $type: "string" } })
    .project({ _id: 1, mobile: 1 })
    .toArray();
  if (stringMobiles.length) {
    console.log(
      `\n⚠️  ${stringMobiles.length} account(s) store mobile as a string:`,
    );
    stringMobiles.slice(0, 20).forEach((u) => console.log(`   ${u._id} → ${u.mobile}`));
    if (APPLY) {
      for (const u of stringMobiles) {
        const digits = String(u.mobile).replace(/\D/g, "").slice(-10);
        if (digits.length !== 10) {
          console.log(`   skipped ${u._id}: "${u.mobile}" is not a 10-digit number`);
          continue;
        }
        await userModel.collection.updateOne(
          { _id: u._id },
          { $set: { mobile: Number(digits) } },
        );
      }
      console.log("   → converted to numbers");
    }
  }

  const duplicates = await findDuplicateMobiles();
  if (!duplicates.length) {
    console.log("\n✅ No duplicate mobile numbers.");
  } else {
    console.log(`\n❌ ${duplicates.length} number(s) held by multiple accounts:\n`);
  }

  for (const dup of duplicates) {
    const users = await userModel.find({ _id: { $in: dup.ids } }).lean();
    const survivor = pickSurvivor(users);
    const losers = users.filter((u) => String(u._id) !== String(survivor._id));

    console.log(`  ${dup._id} → ${users.length} accounts`);
    console.log(`    keep   ${survivor._id} (${survivor.name || "no name"}, ` +
      `${survivor.businessId?.length || 0} business, wallet ${survivor.wallet || 0})`);
    for (const loser of losers) {
      console.log(`    merge  ${loser._id} (${loser.name || "no name"}, ` +
        `${loser.businessId?.length || 0} business, wallet ${loser.wallet || 0})`);
    }

    if (!APPLY) continue;

    const backfill = {};
    for (const field of ["name", "email", "image", "fcm", "userRole"]) {
      if (survivor[field]) continue;
      const donor = losers.find((l) => l[field]);
      if (donor) backfill[field] = donor[field];
    }

    const businessIds = new Set(
      (survivor.businessId || []).map((id) => String(id)),
    );
    losers.forEach((l) =>
      (l.businessId || []).forEach((id) => businessIds.add(String(id))),
    );

    await userModel.updateOne(
      { _id: survivor._id },
      {
        $set: {
          ...backfill,
          businessId: [...businessIds].map((id) => new mongoose.Types.ObjectId(id)),
          phoneVerified: survivor.phoneVerified || losers.some((l) => l.phoneVerified),
          wallet: users.reduce((sum, u) => sum + (u.wallet || 0), 0),
          whatsappWallet: users.reduce((sum, u) => sum + (u.whatsappWallet || 0), 0),
        },
      },
    );

    await userModel.updateMany(
      { _id: { $in: losers.map((l) => l._id) } },
      { $set: { mobile: null, mergedInto: survivor._id, disable: true } },
    );
    console.log("    → merged");
  }

  if (APPLY) {
    console.log("\nEnforcing the unique mobile index...");
    const result = await ensureUserIndexes();
    console.log(
      result.duplicates.length
        ? "❌ Index still not enforced — duplicates remain."
        : "✅ Unique mobile index is in place.",
    );
  } else if (duplicates.length || stringMobiles.length) {
    console.log("\nRe-run with --apply to fix the above.");
  }

  await mongoose.disconnect();
};

main().catch((error) => {
  console.error("Failed:", error.message);
  process.exit(1);
});
