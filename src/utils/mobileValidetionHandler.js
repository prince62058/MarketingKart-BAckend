const responseBuilder = require("./responseBuilder");
const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("./../Message/defaultMessage");

/**
 * Normalizes input into a standard 10-digit numeric mobile number.
 * Handles numbers, strings, +91 prefixes, leading zeros, dashes, and spaces.
 * Returns the 10-digit number if valid, or null if invalid.
 */
function normalizeMobileNumber(input) {
  if (input === null || input === undefined) return null;
  const digits = String(input).replace(/\D/g, "");
  let cleaned = digits;
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.length === 11 && cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.length !== 10) {
    return null;
  }
  return Number(cleaned);
}

exports.normalizeMobileNumber = normalizeMobileNumber;

exports.validateMobileNumber = (mobileNumber, res) => {
  const normalized = normalizeMobileNumber(mobileNumber);
  if (!normalized) {
    if (res) {
      res
        .status(statusCodes["Bad Request"])
        .json(
          responseBuilder(
            apiResponseStatusCode[400],
            "Please enter a valid 10-digit mobile number",
          ),
        );
    }
    return false;
  }
  return true;
};
