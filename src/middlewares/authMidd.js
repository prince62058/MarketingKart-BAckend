const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");

exports.authUser = async (req, res, next) => {
  const SECRET_KEY = process.env.JWT_SECRET_KEY || "SECRETEKEY";
  const authHeader = req.headers["authorization"];
  const { userId } = req.query;

  if (!authHeader && !userId) {
    return res
      .status(statusCodes?.["Bad Request"])
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          authHeader === "" ? "Authorization token is empty" : "Authorization token or userId is required",
        ),
      );
  }

  // Extract the token by removing "Bearer " prefix
  const token = authHeader?.split(" ")[1];
  if (!token && !userId) {
    return res
      .status(statusCodes?.["Unauthorized"])
      .json(responseBuilder(apiResponseStatusCode[401], "Token is missing"));
  }

  let decoded;
  if (token && !userId) {
    try {
      // Verify the token with the secret key
      decoded = jwt.verify(token, SECRET_KEY);
    } catch (err) {
      return res
        .status(statusCodes?.["Unauthorized"])
        .json(
          responseBuilder(
            apiResponseStatusCode[401],
            "Invalid or expired token",
          ),
        );
    }
  }

  const check = userId || decoded?.User;

  try {
    // Find the user in the database using the userId or token payload
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

    req.user = user; // Attach the user object to the request
    next(); // Proceed to the next middleware
  } catch (error) {
    return res
      .status(statusCodes?.["Internal Server Error"])
      .json(
        responseBuilder(
          apiResponseStatusCode[500],
          "An error occurred while fetching user data",
        ),
      );
  }
};
