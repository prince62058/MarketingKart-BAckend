const cityModel = require("../models/cityModel");

const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
exports.cityMid = async function (req, res, next) {
    let city = await cityModel.findById(req.params.cityId);
    if (!city) {
      return res
      .status(statusCodes?.["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
    }
    req.city = city;
    next();
  
};
