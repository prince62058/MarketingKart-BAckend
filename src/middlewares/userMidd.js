const { statusCodes, apiResponseStatusCode, defaultResponseMessage } = require("../Message/defaultMessage");
const userModel = require("../models/userModel");

const responseBuilder = require("../utils/responseBuilder");
exports.userMid = async function (req, res, next) {
  let user = await userModel.findById(req.params.userId);
  if (!user) {
    return res
      .status(statusCodes["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
  }
  req.user = user;
  next();
};
