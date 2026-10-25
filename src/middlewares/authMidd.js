const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const asyncHandler = require("../utils/asyncHandler");

// This old shared admin token was shipped in the public web bundle. Require a real login.
const REVOKED_TOKEN_HASH = "db3bd56ed9895ec245ec77e91b616e7f87e1280afefe2b86071f15e178247c5a";

/**
 * Checks a bearer token's signature and returns the account id inside it.
 * Resolves to { userId } (null when the token is missing or invalid) and { revoked: true } for the
 * retired shared token. Used by authUser and by the Socket.IO handshake, so both accept the same tokens.
 */
const decodeAuthToken = (token) => {
  if (!token) return { userId: null };
  if (require("crypto").createHash("sha256").update(token).digest("hex") === REVOKED_TOKEN_HASH) {
    return { userId: null, revoked: true };
  }
  const SECRET_KEYS = [
    process.env.JWT_SECRET,
    process.env.TOKEN_KEY,
  ].filter(Boolean);
  let decoded = null;
  for (const key of SECRET_KEYS) {
    try {
      decoded = jwt.verify(token, key);
      if (decoded) break;
    } catch (_) {}
  }
  return { userId: decoded?.User || decoded?.userId || decoded?.id || decoded?._id || null };
};
exports.decodeAuthToken = decodeAuthToken;

exports.authUser = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader?.trim();

  const { userId: tokenUserId, revoked } = decodeAuthToken(token);
  if (revoked) {
    return res.status(401).json({ success: false, message: "Please sign in again" });
  }
  if (!tokenUserId) {
    return res
      .status(statusCodes?.["Unauthorized"])
      .json(responseBuilder(apiResponseStatusCode[401], "Invalid or expired token"));
  }

  try {
    const user = await userModel.findById(tokenUserId);
    if (!user) {
      return res
        .status(statusCodes?.["Unauthorized"])
        .json(
          responseBuilder(
            apiResponseStatusCode[401],
            "User not found or token expired",
          ),
        );
    }
    // Tokens live for up to a year, so banning an account has to cut off tokens that were
    // issued before the ban, not just stop new logins.
    if (user.disable) {
      return res
        .status(403)
        .json(responseBuilder(apiResponseStatusCode[401], "Your account has been disabled"));
    }
    req.user = user;
    // Route middleware such as userMid swaps req.user for the account named in the URL, so the
    // caller stays available here for ownership checks.
    req.authUser = user;
    next();
  } catch (error) {
    return res
      .status(statusCodes?.["Bad Request"])
      .json(
        responseBuilder(apiResponseStatusCode[400], "Something went wrong"),
      );
  }
};

// Use after authUser on routes that must be restricted to admin accounts. Reads the caller
// (req.authUser) rather than req.user, which userMid may have replaced with another account.
exports.isAdmin = (req, res, next) => {
  if ((req.authUser || req.user)?.userType !== "ADMIN") {
    return res
      .status(statusCodes?.["Unauthorized"] || 403)
      .json(responseBuilder(apiResponseStatusCode[401], "Admin access required"));
  }
  next();
};

// authUser then isAdmin, ready to drop into a route: router.post("/x", adminOnly, handler).
exports.adminOnly = [asyncHandler(exports.authUser), exports.isAdmin];
