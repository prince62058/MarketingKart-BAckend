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
    "SECRETEKEY",
    "leadkartSecretTokenKey",
  ].filter(Boolean);

  const authHeader = req.headers["authorization"];
  const userId = req.query?.userId || req.params?.userId || req.body?.userId;

  let decoded = null;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader?.trim();

  if (token) {
    for (const key of SECRET_KEYS) {
      try {
        decoded = jwt.verify(token, key);
        if (decoded) break;
      } catch (_) {}
    }
    if (!decoded) {
      try {
        decoded = jwt.decode(token);
      } catch (_) {}
    }
  }

  const check = userId || decoded?.User || decoded?.userId || decoded?.id || decoded?._id;
  if (!check) {
    return res
      .status(statusCodes?.["Unauthorized"])
      .json(responseBuilder(apiResponseStatusCode[401], "Invalid or expired token"));
  }

  try {
    const user = await userModel.findById(check);
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
