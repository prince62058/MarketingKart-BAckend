const userModel = require("../models/userModel");

const MOBILE_INDEX_NAME = "mobile_unique_when_set";

/**
 * Returns every mobile number that is currently held by more than one account.
 * Grouping on the string form catches the historical mix of Number and String
 * mobiles, which a plain `$group: { _id: "$mobile" }` would treat as distinct.
 */
const findDuplicateMobiles = async () => {
  return userModel.collection
    .aggregate([
      { $match: { mobile: { $nin: [null, ""] } } },
      {
        $group: {
          _id: { $toString: "$mobile" },
          count: { $sum: 1 },
          ids: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
};

/**
 * Guarantees the database itself enforces "one account per phone number".
 *
 * The schema declares the index, but Mongoose's automatic build fails silently
 * when duplicates already exist — which is exactly how duplicate logins get to
 * survive. This runs on every boot, reports what it found, and never leaves the
 * situation ambiguous in the logs.
 */
const ensureUserIndexes = async ({ log = console } = {}) => {
  const collection = userModel.collection;

  const existing = await collection.indexes();
  const alreadyCorrect = existing.some(
    (idx) => idx.name === MOBILE_INDEX_NAME && idx.unique,
  );

  // A legacy plain `mobile_1` index (non-unique, or unique but without the
  // partial filter that exempts email-only admins) conflicts with the one we
  // want on the same key, so it has to go first.
  const legacy = existing.find(
    (idx) => idx.name !== MOBILE_INDEX_NAME && idx.key && idx.key.mobile === 1,
  );
  if (legacy) {
    try {
      await collection.dropIndex(legacy.name);
      log.info?.(`[users] dropped legacy mobile index "${legacy.name}"`);
    } catch (error) {
      log.warn?.(
        `[users] could not drop legacy mobile index "${legacy.name}": ${error.message}`,
      );
    }
  }

  if (alreadyCorrect && !legacy) {
    log.info?.("[users] unique mobile index is in place — one account per number");
    return { created: false, duplicates: [] };
  }

  const duplicates = await findDuplicateMobiles();
  if (duplicates.length) {
    log.error?.(
      `[users] CANNOT enforce unique mobile: ${duplicates.length} number(s) are held by multiple accounts. ` +
        `Duplicate logins will keep happening until these are merged. ` +
        `Run: node src/scripts/repairDuplicateMobileAccounts.js --apply`,
    );
    duplicates.slice(0, 20).forEach((d) => {
      log.error?.(`[users]   ${d._id} → ${d.count} accounts: ${d.ids.join(", ")}`);
    });
    return { created: false, duplicates };
  }

  await collection.createIndex(
    { mobile: 1 },
    {
      unique: true,
      partialFilterExpression: { mobile: { $type: "number" } },
      name: MOBILE_INDEX_NAME,
    },
  );
  log.info?.("[users] created unique mobile index — one account per number");
  return { created: true, duplicates: [] };
};

module.exports = { ensureUserIndexes, findDuplicateMobiles, MOBILE_INDEX_NAME };
