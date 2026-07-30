const Staff = require("../models/staffModel");
const { statusCodes } = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const { apiResponseStatusCode } = require("../Message/defaultMessage");

/**
 * Middleware to validate staff ID and attach staff to request object
 */
exports.staffMid = async (req, res, next) => {
  try {
    const { staffId } = req.params;
    
    if (!staffId) {
      return res.status(statusCodes["Bad Request"]).json(
        responseBuilder(
          apiResponseStatusCode[400],
          "Staff ID is required"
        )
      );
    }

    const staff = await Staff.findById(staffId);
    
    if (!staff) {
      return res.status(statusCodes["Not Found"]).json(
        responseBuilder(
          apiResponseStatusCode[404],
          "Staff member not found"
        )
      );
    }

    if (staff.isActive === false) {
      return res.status(statusCodes["Forbidden"]).json(
        responseBuilder(
          apiResponseStatusCode[403],
          "This staff account is inactive"
        )
      );
    }

    req.staff = staff;
    next();
  } catch (error) {
    console.error("Error in staff middleware:", error);
    return res.status(statusCodes["Internal Server Error"]).json(
      responseBuilder(
        apiResponseStatusCode[500],
        "Error processing staff request"
      )
    );
  }
};

/**
 * Middleware to check if the authenticated user is a staff member
 */
exports.isStaff = (req, res, next) => {
  if (!req.user || req.user.role !== 'STAFF') {
    return res.status(statusCodes["Forbidden"]).json(
      responseBuilder(
        apiResponseStatusCode[403],
        "Access denied. Staff privileges required."
      )
    );
  }
  next();
};
