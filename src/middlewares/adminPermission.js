const staffModel = require("../models/staffModel");
const responseBuilder = require("../utils/responseBuilder");
const { apiResponseStatusCode } = require("../Message/defaultMessage");

const normalize = (value) => String(value).toUpperCase().replace(/\s+/g, "_");

/**
 * For admin routes that only some staff may use (the admin panel hides these pages by the same codes,
 * e.g. STAFF, COMPANY). Use after authUser + isAdmin.
 *
 * An admin account with no staff record has every permission; a staff record limits the account to the
 * codes on it, exactly as adminLogIn reports them to the panel.
 */
exports.requirePermission = (code) => async (req, res, next) => {
  try {
    const caller = req.authUser || req.user;
    const staff = await staffModel.findOne({ userId: caller._id });
    if (!staff) return next();

    const granted = (staff.permissions || []).map(normalize);
    if (staff.isActive !== false && (granted.includes("ALL") || granted.includes("*") || granted.includes(code))) {
      return next();
    }
    return res
      .status(403)
      .json(responseBuilder(apiResponseStatusCode[401], "You do not have permission for this"));
  } catch (error) {
    return next(error);
  }
};
