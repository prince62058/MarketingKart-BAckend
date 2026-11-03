const service = require("../services/adBudgetSettingsService");
const responseBuilder = require("../utils/responseBuilder");
const { apiResponseStatusCode } = require("../Message/defaultMessage");

exports.getSettings = async (req, res) => {
  const settings = await service.get();
  return res.status(200).json(responseBuilder(apiResponseStatusCode[200], "Custom budget rules", settings));
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await service.update(req.body, req.authUser || req.user);
    return res.status(200).json(responseBuilder(apiResponseStatusCode[200], "Custom budget rules saved", settings));
  } catch (error) {
    if (!error.status) throw error;
    return res.status(error.status).json({ ...responseBuilder(apiResponseStatusCode[400], error.message), success: false });
  }
};
