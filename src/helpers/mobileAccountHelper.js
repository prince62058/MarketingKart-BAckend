const userModel = require("../models/userModel");

/**
 * Resolves the one account that owns `mobileNum`, creating it only when this
 * phone number has genuinely never been seen before.
 *
 * The lookup and the insert happen in a single atomic upsert, so two devices
 * hitting "Send OTP" at the same moment converge on the same _id instead of
 * racing between findOne() and create() and producing two logins for one
 * number. `mobileNum` must already be normalized (utils/mobileValidetionHandler
 * → normalizeMobileNumber) because Mongoose does not run schema setters on
 * query filters.
 *
 * @param {number} mobileNum normalized 10-digit number
 * @param {object} set fields to write on both insert and update (OTP, fcm, ...)
 * @returns {Promise<object>} the existing or newly created user document
 */
const findOrCreateUserByMobile = async (mobileNum, set = {}) => {
  if (typeof mobileNum !== "number" || Number.isNaN(mobileNum)) {
    throw new Error(
      "findOrCreateUserByMobile requires a normalized 10-digit mobile number",
    );
  }

  const filter = { mobile: mobileNum };
  // `mobile` is intentionally absent from $setOnInsert: MongoDB seeds the new
  // document from the filter's equality clause, and naming the same path in
  // both would be rejected as an update conflict.
  const update = { $set: set, $setOnInsert: { phoneVerified: false } };

  try {
    return await userModel.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
    });
  } catch (error) {
    // Two upserts raced and the unique index rejected the loser. The winner's
    // document exists now, so a plain update lands on that same account.
    if (error?.code === 11000) {
      return await userModel.findOneAndUpdate(filter, { $set: set }, { new: true });
    }
    throw error;
  }
};

module.exports = { findOrCreateUserByMobile };
