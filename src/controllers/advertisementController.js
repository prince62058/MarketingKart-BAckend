const {
  apiResponseStatusCode,
  statusCodes,
  defaultResponseMessage,
} = require("../Message/defaultMessage");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");
const advertisementService = require("../services/advertisementService");
const responseBuilder = require("../utils/responseBuilder");
const advertisementModel = require("../models/advertisementModel");

// Create a new advertisement
exports.createAdvertisement = async (req, res) => {
  const {
    title,
    discription,
    isInstagram,
    isFacebook,
    isGoogle,
    advertisementType,
    minimumBudget,
  } = req.body;
  let image = req?.file ? req.file.location : null;
  const advertisementData = {
    image,
    title,
    discription,
    isInstagram,
    isFacebook,
    isGoogle,
    advertisementType,
    minimumBudget,
  };
  const check = await advertisementService.getAdvertisementsByType(
    advertisementType
  );
  if (check) {
    return res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          "This AdvertisementType Is Allready Create"
        )
      );
  }
  const createData = await advertisementService.createAdvertisement(
    advertisementData
  );
  return res
    .status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage?.CREATED,
        createData
      )
    );
};

// Get all advertisements
exports.getAllAdvertisements = async (req, res) => {
  const { page = 1 ,search ,disable} = req.query;
  const skip = (page - 1) * 20;
  
  // Fetch the total count
  let query = {}
  if (search) {
    query.title = new RegExp(search, "i");
  }
  if(disable){
    query.disable = disable
  }
  const findAll = await advertisementService.getAllAdvertisements(query,skip);
  const totalCount = await advertisementModel.countDocuments(query)
  const pageCount = Math.ceil(totalCount / 20);
  if (!findAll?.length) {
    return res
      .status(statusCodes["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND,
          findAll
        )
      );
  }
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        findAll,
        pageCount
      )
    );
};

// Get a single advertisement
exports.getSingleAdvertisement = async (req, res) => {
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        req.advertisement
      )
    );
};

// Update an advertisement
exports.updateAdvertisement = async (req, res) => {
  let advertisemen = req.advertisement;
  const {
    title,
    discription,
    isInstagram,
    isFacebook,
    isGoogle,
    advertisementType,
    minimumBudget,
  } = req.body;
  let image = req.file ? req.file.location : advertisemen?.image;
  if (req.file && advertisemen?.image) {
    deleteFileFromObjectStorage(advertisemen?.image);
  }
  const updateData = {
    image,
    title,
    description:discription,
    isInstagram,
    isFacebook,
    isGoogle,
    advertisementType,
    minimumBudget,
  };
  const updateAdvertisement = await advertisementService.updateAdvertisement(
    req.advertisement?._id,
    updateData
  );
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.UPDATED,
        updateAdvertisement
      )
    );
};

// Disable an advertisement
exports.disableAdvertisement = async (req, res) => {
  const getAdvertisement = req.advertisement;
  const updateDisable = await advertisementService.disableAdvertisement(
    getAdvertisement?._id,
    getAdvertisement
  );
  let message = updateDisable?.disable
    ? defaultResponseMessage?.DISABLED
    : defaultResponseMessage?.ENABLED;
  return res
    .status(statusCodes.OK)
    .json(responseBuilder(apiResponseStatusCode[200], message));
};

exports.getEstimates = async (req, res) => {
  const getAdvertisement = req.advertisement;
  const { instaBudget, fbBudget } = req.query;
  let obj = {};
  if (getAdvertisement?.advertisementType == "LEADS") {
    let reach = Number(instaBudget) * 6.5 + Number(fbBudget) * 8;
    let leads = Number(instaBudget) * 0.0135 + Number(fbBudget) * 0.014;
    obj = {
      totalLeads: Math.ceil(leads),
      totalReach: Math.ceil(reach),
    };
  }
  else if (getAdvertisement?.advertisementType == "WHATSAPP_MESSAGES") {
    let reach = Number(instaBudget) * 8 + Number(fbBudget) * 8;
    let leads = Number(instaBudget) *  0.0185 + Number(fbBudget) * 0.0215;
    obj = {
      totalLeads: Math.ceil(leads),
      totalReach: Math.ceil(reach),
    };
  }
  else if (getAdvertisement?.advertisementType == "CALLS") {
    let reach = Number(instaBudget) * 9 + Number(fbBudget) * 9;
    let leads = Number(instaBudget) * 0.0225 + Number(fbBudget) * 0.0315;
    obj = {
      totalLeads: Math.ceil(leads),
      totalReach: Math.ceil(reach),
    };
  }
  else if (getAdvertisement?.advertisementType == "WEBSITE_VISITORS") {
    let reach = Number(instaBudget) * 13 + Number(fbBudget) * 12.9;
    let leads = Number(instaBudget) *  0.775 + Number(fbBudget) * 0.865;
    obj = {
      totalLeads: Math.ceil(leads),
      totalReach: Math.ceil(reach),
    };
  }
  else if (getAdvertisement?.advertisementType == "APP_INSTALLS") {
    let reach = Number(instaBudget) * 7.7 + Number(fbBudget) * 8.4;
    let leads = Number(instaBudget) * 0.029 + Number(fbBudget) * 0.04;
    obj = {
      totalLeads: Math.ceil(leads),
      totalReach: Math.ceil(reach),
    };
  }

  return res
    .status(statusCodes.OK)
    .json(responseBuilder(apiResponseStatusCode[200], "Estimates Fatch Successfully",obj));
};

// Delete an advertisement
exports.deleteAdvertisement = async (req, res) => {
  const getAdvertisement = req.advertisement;
  
  if (getAdvertisement?.image) {
    deleteFileFromObjectStorage(getAdvertisement?.image);
  }

  await advertisementService.deleteAdvertisement(getAdvertisement?._id);
  
  return res
    .status(statusCodes.OK)
    .json(responseBuilder(apiResponseStatusCode[200], defaultResponseMessage?.DELETED));
};
