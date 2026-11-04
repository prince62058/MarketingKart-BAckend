const service = require("../services/paymentReportService");
const responseBuilder = require("../utils/responseBuilder");
const { apiResponseStatusCode } = require("../Message/defaultMessage");

exports.list = async (req, res) => {
  try {
    const data = await service.report(req.query || {});
    return res.status(200).json(responseBuilder(apiResponseStatusCode[200], "Payments", data));
  } catch (error) {
    if (!error.status) throw error;
    return res.status(error.status).json({ ...responseBuilder(apiResponseStatusCode[400], error.message), success: false });
  }
};
