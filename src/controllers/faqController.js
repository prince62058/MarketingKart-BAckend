const {
    apiResponseStatusCode,
    defaultResponseMessage,
    statusCodes,
  } = require("../Message/defaultMessage");
  const responseBuilder = require("../utils/responseBuilder");
  const faqService = require("../services/faqService");


  exports.createFaq = async (req, res) => {
    const data = {
    question:req.body.question,
    answer:req.body.answer,
    type:req?.body?.type
    };
   
    const Faq = await faqService.createFaq(data);
    res
      .status(statusCodes.Created)
      .json(
        responseBuilder(
          apiResponseStatusCode[201],
          defaultResponseMessage.CREATED,
          Faq
        )
      );
  };
  
  exports.getAllFaqs = async (req, res) => {
    const { disable, type, search } = req.query;
    const { page = 1 } = req.query;
    const skip = (page - 1) * 20;
    let obj = {};
    if (disable) {
      obj.disable = disable;
    }
    if (type) {
      obj.type = type;
    }
    if (search) {
      obj.question = { $regex: search, $options: "i" };
      obj.answer = { $regex: search, $options: "i" };
    }
    const data = await faqService.getAllFaq(obj, skip);
    // Fetch the total count
    const totalCount = (await faqService.getAllFaq(obj)).length;
    const pageCount = Math.ceil(totalCount / 20);
    res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage.FETCHED,
          data,
          pageCount
        )
      );
  };
  
  exports.updateFaqs = async (req, res) => {
    const FaqData = req.faq
    const data = {
        question:req.body.question,
        answer:req.body.answer,
        type:req.body.type
        };
       
    const Faq = await faqService.updateFaq(FaqData?._id, data);
    res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage.UPDATED,
          Faq
        )
      );
  };
  
  exports.disableFaqs = async (req, res) => {
    const FaqData = req.faq
    const Faq = await faqService.disableFaq(FaqData);
    res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          Faq.disable
            ? defaultResponseMessage.DISABLED
            : defaultResponseMessage.ENABLED,
          Faq
        )
      );
  };
  
  exports.getDetailsFaq = async (req, res) => {
    const FaqData = req.faq
    res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage.FETCHED,
          FaqData
        )
      );
  };