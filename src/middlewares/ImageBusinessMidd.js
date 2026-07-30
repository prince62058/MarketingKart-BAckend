const ImageBusinessModel = require("../models/ImageBusinessModel");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
exports.imageBusinessMid = async function (req, res, next) {
    let imageBusiness = await ImageBusinessModel.findById(req.params.imageBusinessId);
    if (!imageBusiness) {
      return res
      .status(statusCodes?.["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
    }
    req.imageBusiness = imageBusiness;
    next();
  
};
