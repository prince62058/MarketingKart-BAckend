const stateService = require("../services/stateService");
const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");
const stateModel = require("../models/stateModel");
exports.createState = async (req, res) => {
  let { name } = req.body;
  let countryId = req.params.countryId;
  if (!name) {
    return res
      .status(statusCodes.BAD_REQUEST)
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          defaultResponseMessage.INVALID_REQUEST,
          "name is required"
        )
      );
  }
  let find = await stateService.getStateName({
    name: name.toUpperCase(),
    countryId: countryId,
  });
  if (find) {
    return res
      .status(statusCodes.BAD_REQUEST)
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          defaultResponseMessage.ALREADY_EXISTS,
          "State Already Created"
        )
      );
  }
  let data = await stateService.createState({
    name: name.toUpperCase(),
    countryId: countryId,
    icon: req.file ? req.file.location : null,
  });
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.CREATED,
        data
      )
    );
};

exports.getAllState = async (req, res) => {
  let { name, countryId } = req.query;
	  const { page = 1 } = req.query;
  const skip = (page - 1) * 20;
  let obj = {};
  if (name) {
    obj.name = RegExp(name, "i");
  }
  if (countryId) {
    obj.countryId = countryId;
  }
  let allstate = await stateService.getAllState(obj);


  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        allstate,
      )
    );
};

exports.updateState = async (req, res) => {
  const { name, countryId } = req.body;
  let getStateById = req.state;

  let find = await stateService.getStateName({
    name: name?.toUpperCase() ? name?.toUpperCase() : getStateById.name,
    countryId: countryId ? countryId : getStateById.countryId,
  });
  if (find && find._id.toString() != getStateById._id) {
    return res
      .status(statusCodes.BAD_REQUEST)
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          defaultResponseMessage.ALREADY_EXISTS,
          "State Already Created"
        )
      );
  }

  let icon = req.file ? req.file.location : getStateById.icon;
  if (req.file && getStateById.icon != null) {
    deleteFileFromObjectStorage(getStateById.icon);
  }
  let update = await stateService.updateState(getStateById._id, {
    name: name?.toUpperCase(),
    countryId: countryId,
    icon: icon,
  });
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.UPDATED,
        update
      )
    );
};

exports.delete = async (req, res) => {
  const stateFind = req.state;
  const updateDisable = await stateService.disableState(stateFind);
  return res
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
