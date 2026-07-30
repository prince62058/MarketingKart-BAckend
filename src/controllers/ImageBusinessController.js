const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const ImageBusinessService = require("../services/ImageBusinessService");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");


exports.createImageBusiness = async (req, res) => {
  const data = {
    imageType: req.body.imageType,
    businessId: req.body.businessId,
    aiImageId: req.body.aiImageId,
    businessCategoryId: req.body.businessCategoryId,
    servicesId: req.body.servicesId,
    imageCategoryId: req.body.imageCategoryId,
    image: req.file.location,
  };

  const ImageBusiness = await ImageBusinessService.createImageBusinessModel(data);
  res
    .status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage.CREATED,
        ImageBusiness
      )
    );
};

exports.getAllImageBusiness = async (req, res) => {
  const { disable } = req.query;
	 const { page = 1 } = req.query;
  const skip = (page - 1) * 20;
  let obj = {};
  if (disable) {
    obj.disable = disable;
  }
  const countries = await ImageBusinessService.getAllImageBusinessModel(obj,skip);
	  // Fetch the total count
  const totalCount = (await ImageBusinessService.getAllImageBusinessModel(obj)).length;
  const pageCount = Math.ceil(totalCount / 20);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        countries,
		  pageCount
      )
    );
};

exports.updateImageBusiness = async (req, res) => {
  const ImageBusinessData = req.imageBusiness
  const data = {
    imageType: req.body.imageType,
    businessId: req.body.businessId,
    aiImageId: req.body.aiImageId,
    businessCategoryId: req.body.businessCategoryId,
    servicesId: req.body.servicesId,
    imageCategoryId: req.body.imageCategoryId,
    image: req.file.location ? req.file.location : ImageBusinessData.image,
  };
  if (req.file && ImageBusinessData.image != null) {
    deleteFileFromObjectStorage(ImageBusinessData.image);
  }
  const ImageBusiness = await ImageBusinessService.updateImageBusinessModel(ImageBusinessData?._id, data);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.UPDATED,
        ImageBusiness
      )
    );
};

exports.disableImageBusiness = async (req, res) => {
  const ImageBusinessData = req.imageBusiness
  const ImageBusiness = await ImageBusinessService.disableImageBusinessModel(ImageBusinessData);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        ImageBusiness.disable
          ? defaultResponseMessage.DISABLED
          : defaultResponseMessage.ENABLED,
        ImageBusiness
      )
    );
};

exports.getDetailsImageBusiness = async (req, res) => {
  const data = req.imageBusiness
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        data
      )
    );
};