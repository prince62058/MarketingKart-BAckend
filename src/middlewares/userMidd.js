const { statusCodes, apiResponseStatusCode, defaultResponseMessage } = require("../Message/defaultMessage");
const userModel = require("../models/userModel");

const responseBuilder = require("../utils/responseBuilder");
exports.userMid = async function (req, res, next) {
  let user = await userModel.findById(req.params.userId);
  if (!user) {
    return res
      .status(statusCodes["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage?.NOT_FOUND
        )
      );
  }
  // After authUser the caller is in req.authUser. Replacing req.user with whichever account the URL
  // names would let any signed-in user read or change anyone else, so only the owner or an admin
  // gets through.
  const caller = req.authUser;
  if (caller && String(caller._id) !== String(user._id) && caller.userType !== "ADMIN") {
    return res
      .status(403)
      .json(responseBuilder(apiResponseStatusCode[401], "You can only access your own account"));
  }
  req.user = user;
  next();
};
