const planModel = require("../models/planModel");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
exports.planMid = async function (req, res, next) {
    let plan = await planModel.findById(
      req.params.planId
    ).populate("advertisementTypeId","advertisementType");
    if (!plan) {
      return res
      .status(statusCodes?.["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
    }
    req.plan = plan;
    next();
  
};
