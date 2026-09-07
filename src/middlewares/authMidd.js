const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");

exports.authUser = async (req, res, next) => {
  const SECRET_KEYS = [
    process.env.JWT_SECRET,
    process.env.TOKEN_KEY,
  ].filter(Boolean);

  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader?.trim();

  let decoded = null;
  if (token) {
    for (const key of SECRET_KEYS) {
      try {
        decoded = jwt.verify(token, key);
        if (decoded) break;
      } catch (_) {}
    }
  }

  const tokenUserId = decoded?.User || decoded?.userId || decoded?.id || decoded?._id;
  if (!tokenUserId) {
    return res
      .status(statusCodes?.["Unauthorized"])
      .json(responseBuilder(apiResponseStatusCode[401], "Invalid or expired token"));
  }

  try {
    const user = await userModel.findById(tokenUserId);
    if (!user) {
      return res
        .status(statusCodes?.["Not Found"])
        .json(
          responseBuilder(
            apiResponseStatusCode[404],
            defaultResponseMessage?.NOT_FOUND,
          ),
        );
    }
    req.user = user;
    next();
  } catch (error) {
    return res
      .status(statusCodes?.["Bad Request"])
      .json(
        responseBuilder(apiResponseStatusCode[400], "Something went wrong"),
      );
  }
};

// Use after authUser on routes that must be restricted to admin accounts.
exports.isAdmin = (req, res, next) => {
  if (req.user?.userType !== "ADMIN") {
    return res
      .status(statusCodes?.["Unauthorized"] || 403)
      .json(responseBuilder(apiResponseStatusCode[401], "Admin access required"));
  }
  next();
};
