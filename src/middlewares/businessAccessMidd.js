// Route guards for "this request names a business / lead / campaign": the caller must be an admin or have
// access to the business it belongs to. Use after authUser. A refusal looks like a missing record, so ids
// cannot be probed.
const mongoose = require("mongoose");
const { canAccessBusiness } = require("../helpers/businessAccess");
const leadModel = require("../models/leadModel");
const internalCampaignModel = require("../models/internalCampiagnModel");

const caller = (req) => req.authUser || req.user;
const isAdmin = (req) => caller(req)?.userType === "ADMIN";
const pick = (req, source, field) => req[source]?.[field];
const notFound = (res) => res.status(404).json({ success: false, message: "Not found" });

const guard = (resolveBusinessId, options) => (source, field) => async (req, res, next) => {
  try {
    if (isAdmin(req)) return next();
    const id = pick(req, source, field);
    if (!id || !mongoose.isValidObjectId(id)) return notFound(res);
    const businessId = await resolveBusinessId(String(id));
    if (!businessId || !(await canAccessBusiness(caller(req), businessId, options))) return notFound(res);
    return next();
  } catch (error) {
    return next(error);
  }
};

/** The id in req[source][field] is a business id. */
exports.requireBusinessAccess = guard(async (id) => id);
/** Same, but only the owner (not a team member) may pass. */
exports.requireBusinessOwner = guard(async (id) => id, { ownerOnly: true });
/** The id is a lead id; access follows the lead's business. */
exports.requireLeadAccess = guard(async (id) => (await leadModel.findById(id).select("businessId").lean())?.businessId);
/** The id is an internal campaign (ad) id; access follows the campaign's business. */
exports.requireCampaignAccess = guard(async (id) => (await internalCampaignModel.findById(id).select("businessId").lean())?.businessId);
