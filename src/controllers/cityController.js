const {
createCity,
disableCity,
getAllCity,
getCityName,
updateCity,
} = require("../services/cityService");
const cityModel = require("../models/cityModel");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");
const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");

exports.createCity = async (req, res) => {
  const data = {
    name: req.body.name,
    stateId: req.body.stateId,
    countryId: req.body.countryId,
    cityLat: req.body.cityLat,
    cityLong: req.body.cityLong,
    icon: req.file?.location,
  };
  let obj = {
    name: data?.name?.toUpperCase(),
    countryId: data?.countryId,
    stateId: data?.stateId,
  };
  let find = await getCityName(obj);
  if (find) {
    res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(apiResponseStatusCode[400], "City Already Created")
      );
  }
  const createData = await createCity(data);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage?.CREATED,
        createData
      )
    );
};

exports.getAllCities = async (req, res) => {
  const query = {};
  console.log("djjsdhsjhdjka")
  const { page = 1 } = req.query;
  const skip = (page - 1) * 20;

  if (req.query.countryId) {

    query.countryId = req.query.countryId;
  }
  if (req.query.stateId) {
    query.stateId = req.query.stateId;
  }
  if (req.query.name) {
    query.name = RegExp(req.query.name, "i");
  }
  if (req.query.cityLat) {
    query.cityLat = req.query.cityLat;
  }
  if (req.query.cityLong) {
    query.cityLong = req.query.cityLong;
  }
  const allCities = await getAllCity(query);
	  // Fetch the total count
  //const totalCount = await cityModel.countDocuments(query);
  //const pageCount = Math.ceil(totalCount / 20);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        allCities,
      )
    );
};

exports.updateCity = async (req, res) => {
  const cityData = req.city;
  const data = {
    name: req.body.name,
    stateId: req.body.stateId,
    countryId: req.body.countryId,
    cityLat: req.body.cityLat,
    cityLong: req.body.cityLong,
    icon: req.file ? req.file.location : cityData.icon,
  };
  let obj = {
    name: data?.name?.toUpperCase() ? data?.name?.toUpperCase() : cityData.name,
    countryId: data?.countryId ? data?.countryId : cityData.countryId,
    stateId: data?.stateId ? data?.stateId : cityData.stateId,
  };
  let find = await getCityName(obj);
  if (find && find._id.toString() != cityData._id) {
    res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(apiResponseStatusCode[400], "City Already Created")
      );
  }
  if (req.file && cityData.icon != null) {
    deleteFileFromObjectStorage(cityData.icon);
  }

  const updateCity = await updateCity(cityData._id, data);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.UPDATED,
        updateCity
      )
    );
};

exports.disableCity = async (req, res) => {
  const cityData = req.city;
  const updateDisable = await disableCity(cityData);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        updateDisable.disable
          ? defaultResponseMessage?.DISABLED
          : defaultResponseMessage?.ENABLED,
        updateDisable
      )
    );
};

exports.getCitieById = async (req, res) => {
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        req.city
      )
    );
};


const axios = require('axios');
exports.callback = async (req, res) => {
  const code = req.query.code; // Extract the code from the query parameters

  if (!code) {
    return res.status(400).send("Authorization code not found.");
  }

  try {
    // Exchange the code for an access token
    const tokenResponse = await axios.get(`https://graph.facebook.com/v21.0/oauth/access_token?
      client_id=667170882523356
      &redirect_uri=https://api.leadkart.in/api/callback
      &client_secret=ec35924844fa37b897673105614b8bad
      &code=${code}`);

    const accessToken = tokenResponse.data.access_token;
    res.send(`Access Token: ${accessToken}`);
  } catch (error) {
    console.error("Error exchanging code for token:", error.response?.data || error.message);
    res.status(500).send("Error during token exchange.");
  }
}