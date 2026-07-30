const categoryModel = require("../models/businessCategoryModel");

const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
exports.categoryMid = async function (req, res, next) {
    let category = await categoryModel.findById(req.params.categoryId);
    if (!category) {
      return res
      .status(statusCodes?.["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
    }
    req.category = category;
    next();
};
