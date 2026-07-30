const { statusCodes, apiResponseStatusCode, defaultResponseMessage } = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");

const businessModel = require("../models/businessModel");
// const responseBuilder = require("../utils/responseBuilder");

exports.businessMid = async function (req, res, next) {
    let bussiness = await businessModel.findById(req.params.businessId).populate("servicesId","title").populate("businessCategoryId","title").populate("userId","name");


    
    if (!bussiness) {
      return res
      .status(statusCodes["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
    }
    req.bussiness = bussiness;
    next();
 
};
