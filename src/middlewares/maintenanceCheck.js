// middlewares/maintenanceCheck.js
const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");
const companyModel = require("../models/commpanyModelV2");
const logger = require("../utils/logger");

module.exports = async function maintenanceCheck(req, res, next) {
  try {
    let decoded = null;

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    const SECRET_KEY = process.env.JWT_SECRET || "SECRETEKEY";

    // If token exists, verify it
    if (token) {
      try {
        decoded = jwt.verify(token, SECRET_KEY);
      } catch (err) {
        console.warn("Maintenance Check JWT Warning:", err.message);
      }
    }

    // Fetched company maintenance flag with in-memory caching
    if (global.isUnderMaintenance === undefined || global.isUnderMaintenance === null) {
      const company = await companyModel.findOne().lean();
      global.isUnderMaintenance = !!company?.isUnderMaintenance;
      logger.info(`Maintenance status cached: ${global.isUnderMaintenance}`);
    }

    // Bypass for OPTIONS requests (CORS preflight)
    if (req.method === "OPTIONS") {
      return next();
    }

    const skipPaths = [
      "/api/user/adminLogIn",
      "/api/user/verifyAdminEmailOtp",
      "/api/getNewCompany",
      "/api/toggleMaintenance",
      "/api/whatsapp/webhook",
      "/api/webhook/getWebhook",
    ];

    const platform = req.headers["x-platform"]?.toLowerCase();
    const isAdmin =
      (platform === "admin") ||
      (skipPaths.includes(req.path)) ||
      (decoded &&
        (decoded.userType?.toUpperCase() === "ADMIN" ||
          decoded.User === "64ddafd132d00f6825fd8a9a"));
    
    // If user is ADMIN or request is from admin panel, skip maintenance check
    if (isAdmin) {
      console.log(
        `Bypassing maintenance check (Platform: ${platform || 'N/A'}, Path: ${req.path})`,
      );
      return next();
    }
    
    if (global.isUnderMaintenance) {
      logger.info(`Blocking request due to maintenance mode (Platform: ${platform || 'N/A'}, Path: ${req.path}, Method: ${req.method})`);
      return res.status(503).json({
        success: false,
        message: "Application is under maintenance. Please try again later.",
      });
    }

    // Continue request
    next();
  } catch (error) {
    console.error("Maintenance Check Error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
