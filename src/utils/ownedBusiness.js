const mongoose = require("mongoose");
const Business = require("../models/businessModel");

/**
 * The business `id` if it is on this customer's account (they own it, or it is listed on their user as a
 * team member), otherwise null. Fields that hold tokens are never selected, so the result is safe to
 * pass on to prompts and responses.
 */
async function findOwnedBusiness(user, id, { select = "businessName", populate = [] } = {}) {
  const text = String(id || "").trim();
  if (!/^[0-9a-f]{24}$/i.test(text) || !mongoose.isValidObjectId(text)) return null;
  const listed = (user.businessId || []).some(entry => String(entry) === text);
  let query = Business.findOne(listed ? { _id: text } : { _id: text, userId: user._id }).select(select);
  for (const path of populate) query = query.populate(path.path, path.select);
  return query.lean();
}

module.exports = { findOwnedBusiness };
