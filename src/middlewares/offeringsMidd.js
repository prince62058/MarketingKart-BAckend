const offeringsModel = require("../models/offeringsModel");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
exports.offeringMid = async function (req, res, next) {
    let Offering = await offeringsModel.findById(
      req.params.offeringId
    ).populate("planId","title");
    if (!Offering) {
      return res
      .status(statusCodes?.["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
    }
    req.Offering = Offering;
    next();
  
};
