const offeringsService = require("../services/offeringsService");
const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");
const offeringsModel = require("../models/offeringsModel");


exports.getSingleOffering = async (req, res) => {
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        req.Offering
      )
    );
};

//  Create

exports.createOffering = async (req, res) => {
  const { planId, title, description } = req.body;
  let image = req.file ? req.file.location : null;
  const createData = await offeringsService.createOffering({
    planId,
    title,
    image,
    description,
  });
  res
    .status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage.CREATED,
        createData
      )
    );
};

//  update

exports.updateOffering = async (req, res) => {
  const OfferingData = req.Offering;
  const { planId, title, description } = req.body;
  let image = req.file ? req.file.location : req.Offering?.image;
  if (req.file && req.Offering?.image != null) {
    deleteFileFromObjectStorage(req.Offering?.image);
  }
  const updateData = await offeringsService.updateOffering(OfferingData?._id, {
    planId,
    title,
    image,
    description,
  });
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.UPDATED,
        updateData
      )
    );
};


//  getAll
//  getAll

exports.getAllOffering = async (req, res) => {
  const { planId,disable ,search} = req.query;
  const { page = 1 } = req.query;
  const skip = (page - 1) * 20;
  let query ={}
  if(disable){
    query.disable = disable
  }
  if(planId){
    query.planId = planId
  }
  if(search){
    query.title = new RegExp(search, "i");
  }
  const findAll = await offeringsService.getAllOffering(
    query,
    skip
  );
  // Fetch the total count
  const totalCount = await offeringsModel.countDocuments(query)
  const pageCount = Math.ceil(totalCount / 20);
  if (!findAll.length) {
    res
      .status(statusCodes["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage.NOT_FOUND,
          findAll,
       
        )
      );
  } else {
    res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage.FETCHED,
          findAll,
          pageCount
        )
      );
  }
};

//  getSingle

exports.getSinglePlan = async (req, res) => {
  let offering = await offeringsModel.findOne({ planId: req.plan?._id });
  req.plan._doc.offering = offering;
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        req.plan
      )
    );
};
//  disable

exports.disableOffering = async (req, res) => {
  const updateDisable = await offeringsService.disableOffering(req.Offering);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        updateDisable.disable
          ? defaultResponseMessage.DISABLED
          : defaultResponseMessage.ENABLED,
        updateDisable
      )
    );
};


exports.getSingleOffering = async (req, res) => {
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        req.Offering
      )
    );
};
