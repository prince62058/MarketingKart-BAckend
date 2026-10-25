const mongoose = require("mongoose");
const businessModel = require("../models/businessModel");

/**
 * Whether `user` may act on the business: an admin, the business owner, or (unless ownerOnly) a
 * team member whose account lists the business. Mirrors how the app decides which businesses to show.
 */
async function canAccessBusiness(user, businessId, { ownerOnly = false } = {}) {
  if (!user || !businessId || !mongoose.isValidObjectId(businessId)) return false;
  if (user.userType === "ADMIN") return true;
  if (!ownerOnly && (user.businessId || []).some((id) => String(id) === String(businessId))) return true;
  return Boolean(await businessModel.exists({ _id: businessId, userId: user._id }));
}

module.exports = { canAccessBusiness };
