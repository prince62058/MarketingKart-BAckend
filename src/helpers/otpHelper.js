const otpGenerator = require("otp-generator");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");

function otp() {
  return Math.floor(1000 + Math.random() * 9000);
}

module.exports = otp;
