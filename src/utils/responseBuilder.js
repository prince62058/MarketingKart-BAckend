const {
  statusCodes,
  apiResponseStatusCode,
} = require("../Message/defaultMessage");

function responseBuilder(statusCode, message, data ,page, pageCount) {
  return {
    status: statusCode,
    success:
      statusCode == apiResponseStatusCode[400] ||
      statusCode == apiResponseStatusCode[500] ||
      statusCode == apiResponseStatusCode[406] ||
      statusCode == apiResponseStatusCode[404] ||
      statusCode == apiResponseStatusCode[401] ||
      statusCode == apiResponseStatusCode[422]
        ? false
        : true,
    message: message,
    data: data,
    currentPage:pageCount,
    page: page,
  };
}

module.exports = responseBuilder;
