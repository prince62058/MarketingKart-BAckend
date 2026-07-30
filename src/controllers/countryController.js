const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const countryService = require("../services/countryService");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");


exports.createCountry = async (req, res) => {
  const data = {
    name: req.body.name,
    icon: req.file.location,
  };
  let obj = {
    name: data?.name.toUpperCase(),
  };
  let find = await countryService.getCountryName(obj);
  if (find) {
    res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(apiResponseStatusCode[400], "Country Already Created")
      );
  }
  const country = await countryService.createCountry(data);
  res
    .status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage.CREATED,
        country
      )
    );
};

exports.getAllCountry = async (req, res) => {
  const { disable } = req.query;
	 const { page = 1 } = req.query;
  const skip = (page - 1) * 20;
  let obj = {};
  if (disable) {
    obj.disable = disable;
  }
  const countries = await countryService.getAllCountry(obj,skip);
	  // Fetch the total count
   const totalCount = (await countryService.getAllCountry(obj)).length;
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

exports.updateCountry = async (req, res) => {
  const countryData = req.country;
  const data = {
    name: req.body.name,
    icon: req.file ?req.file.location : countryData.icon,
  };
  let obj = {
    name: data?.name.toUpperCase(),
  };
  let find = await countryService.getCountryName(obj);
  if (find && find?._id.toString() != countryData?._id) {
    res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(apiResponseStatusCode[400], "Country Already Created")
      );
  }
  if (req.file && countryData.icon != null) {
    deleteFileFromObjectStorage(countryData.icon);
  }
  const country = await countryService.updateCountry(countryData?._id, data);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.UPDATED,
        country
      )
    );
};

exports.disableCountry = async (req, res) => {
  const countryData = req.country;
  const country = await countryService.disableCountry(countryData);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        country.disable
          ? defaultResponseMessage.DISABLED
          : defaultResponseMessage.ENABLED,
        country
      )
    );
};
