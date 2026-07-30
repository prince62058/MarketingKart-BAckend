const faqModel = require("../models/faqModel");
const {
  statusCodes,
  apiResponseStatusCode,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
exports.faqMid = async function (req, res, next) {
    let faq = await faqModel.findById(req.params.faqId);
    if (!faq) {
      return res
      .status(statusCodes?.["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
    }
    req.faq = faq;
    next();
  
};
