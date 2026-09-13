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
    const { page = 1, limit = 100 } = req.query;
    const parsedLimit = parseInt(limit) || 100;
    const skip = (Math.max(1, parseInt(page)) - 1) * parsedLimit;
    let obj = {};
    if (disable !== undefined) {
      obj.disable = disable === "true" || disable === true;
    }
    if (type && type !== "ALL") {
      obj.type = type;
    }
    if (search && search.trim()) {
      obj.$or = [
        { question: { $regex: search.trim(), $options: "i" } },
        { answer: { $regex: search.trim(), $options: "i" } }
      ];
    }
    const data = await faqService.getAllFaq(obj, skip, parsedLimit);
    const totalCount = await faqService.countFaqs(obj);
    const pageCount = Math.ceil(totalCount / parsedLimit) || 1;
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
    const FaqData = req.faq;
    const data = {
      question: req.body.question !== undefined ? req.body.question : FaqData.question,
      answer: req.body.answer !== undefined ? req.body.answer : FaqData.answer,
      type: req.body.type !== undefined ? req.body.type : FaqData.type
    };
    if (req.body.disable !== undefined) {
      data.disable = req.body.disable === true || req.body.disable === "true";
    }
       
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
    const FaqData = req.faq;
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

  exports.deleteFaq = async (req, res) => {
    const FaqData = req.faq;
    await faqService.deleteOneFaq(FaqData?._id);
    res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage.DELETED,
          null
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