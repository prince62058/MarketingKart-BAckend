const imageCategoryModel = require("../models/imageCategoryModel");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
exports.imageCategoryMid = async function (req, res, next) {
    let imageCategory = await imageCategoryModel.findById(req.params.imageCategoryId);
    if (!imageCategory) {
      return res
      .status(statusCodes?.["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
    }
    req.imageCategory = imageCategory;
    next();
  
};
