const crypto = require("crypto");
const otpGenerator = require("otp-generator");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");

function otp() {
  return crypto.randomInt(1000, 10000);
}

module.exports = otp;
