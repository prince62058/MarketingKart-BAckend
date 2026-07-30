const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const advertisementModel = require("../models/advertisementModel");
const responseBuilder = require("../utils/responseBuilder");

exports.advertisementMid = async function (req, res, next) {
  let advertisement = await advertisementModel.findById(
    req.params.advertisementId
  );
  if (!advertisement) {
    return res
      .status(statusCodes?.["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
  }
  req.advertisement = advertisement;
  next();
};
