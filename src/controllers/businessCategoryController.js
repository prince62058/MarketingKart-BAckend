const {
  statusCodes,
  defaultResponseMessage,
  apiResponseStatusCode,
} = require("../Message/defaultMessage");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");
const categoryService = require("../services/businessCategoryService");
const responseBuilder = require("../utils/responseBuilder");
const categoryModel = require("../models/businessCategoryModel");

exports.createCategory = async (req, res) => {
  const { title, categoryId } = req.body;
  if (!title) {
    return res
      .status(statusCodes["Bad Request"])
      .json(responseBuilder(apiResponseStatusCode[400], "title is required"));
  }

  const data = await categoryService.createCategory({
    title,
    icon: req.file ? req.file.location : req.body.icon,
    categoryId: categoryId,
  });

  return res
    .status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage?.CREATED,
        data
      )
    );
};

exports.getAllPCategory = async (req, res) => {
  const { page, disable, title } = req.query;

  const skip = (page - 1) * 20;
  let obj = {};
  obj.categoryId = null;
  if (disable) {
    obj.disable = disable;
  }
  if (title) {
    obj.title = new RegExp(title, "i");
  }

  const data = await categoryService.getAllCategory(obj, skip);
  const totalCount = await categoryModel.countDocuments(obj)
  const pageCount = Math.ceil(totalCount / 20);

  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        data,
        pageCount
      )
    );
};

exports.getAllCategory = async (req, res) => {
  const { title, page, categoryId, disable, type, sort, limit: reqLimit } = req.query;
  const limit = reqLimit ? parseInt(reqLimit, 10) : (page ? 20 : 100);
  const skip = page ? (parseInt(page, 10) - 1) * limit : 0;
  const obj = {};
  const obj1 = { orderNumber: 1, createdAt: -1 };
  if (title) {
    obj.title = new RegExp(title, "i");
  }
  if (sort == 1) {
    obj1.orderNumber = 1;
  } else if (sort == -1) {
    obj1.orderNumber = -1;
  }

  if (categoryId) {
    obj.categoryId = categoryId;
  }
  if (disable !== undefined) {
    obj.disable = disable === "true" || disable === true;
  }
  if (type === "category") {
    obj.categoryId = null;
  } else if (type === "service" && !obj.categoryId) {
    delete obj.categoryId; // Ensure servicesId is not null when type is "service"
  }

  // Fetch the data with pagination
  const data = await categoryService.getAllCategory(obj, skip, obj1, limit);

  // Fetch the total count
  const totalCount = await categoryModel.countDocuments(obj);
  const pageCount = Math.ceil(totalCount / limit);

  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        data,
        pageCount,
      ),
    );
};

exports.getCategoryById = async (req, res) => {
  const getCategoryById = req.category;
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        getCategoryById
      )
    );
};

exports.updateCategory = async (req, res) => {
  const getCategoryById = req.category;
  const { title, categoryId, orderNumber } = req.body;
  let icon = req.file ? req.file.location : getCategoryById.icon;
  if (req.file && getCategoryById?.icon != null) {
    deleteFileFromObjectStorage(getCategoryById?.icon);
  }
  await categoryModel.findOneAndUpdate(
    { orderNumber: orderNumber },
    {
      $set: {
        orderNumber: getCategoryById?.orderNumber,
      },
    },
    { new: true }
  );
  const updateCategory = await categoryService.updateCategory(
    req.params.categoryId,
    {
      title,
      icon,
      categoryId,
      orderNumber,
    }
  );

  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.UPDATED,
        updateCategory
      )
    );
};

exports.disableCategory = async (req, res) => {
  const getCategoryById = req.category;
  const updateDisable = await categoryService.disableCategory(getCategoryById);
  let message = updateDisable.disable
    ? defaultResponseMessage?.DISABLED
    : defaultResponseMessage?.ENABLED;

  return res
    .status(statusCodes.OK)
    .json(responseBuilder(apiResponseStatusCode[200], message));
};
