const responseBuilder = require("./responseBuilder");
const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("./../Message/defaultMessage");

exports.validateEmail = (email, res) => {
  var pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!pattern.test(email)) {
    return res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          "Please Provide Valied Email",
        ),
      );
  }
};
