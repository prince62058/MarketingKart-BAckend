const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const imageCategoryService = require("../services/imageCategoryService");

exports.createImageCategory = async (req, res) => {
  const data = {
    name: req.body.name,
  };
  const ImageCategory = await imageCategoryService.createImageCategoryModel(data);
  res
    .status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage.CREATED,
        ImageCategory
      )
    );
};

exports.getAllImageCategory = async (req, res) => {
  const { disable } = req.query;
	 const { page = 1 } = req.query;
  const skip = (page - 1) * 20;
  let obj = {};
  if (disable) {
    obj.disable = disable;
  }
  const find = await imageCategoryService.getAllImageCategoryModel(obj,skip);
	  // Fetch the total count
   const totalCount = (await imageCategoryService.getAllImageCategoryModel(obj)).length;
   const pageCount = Math.ceil(totalCount / 20);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        find ,
		  pageCount
      )
    );
};

exports.updateImageCategory = async (req, res) => {
  const ImageCategoryData = req.imageCategory
  const data = {
    name: req.body.name,
  };

  const ImageCategory = await imageCategoryService.updateImageCategoryModel(ImageCategoryData?._id, data);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.UPDATED,
        ImageCategory
      )
    );
};

exports.disableImageCategory = async (req, res) => {
  const ImageCategoryData = req.imageCategory
  const ImageCategory = await imageCategoryService.disableImageCategoryModel(ImageCategoryData);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        ImageCategory.disable
          ? defaultResponseMessage.DISABLED
          : defaultResponseMessage.ENABLED,
        ImageCategory
      )
    );
};

exports.getDetailsImageCategory = async (req, res) => {
  const data = req.imageCategory
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
