const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");

// CREATE ADS DETAILS

//  getInternalCampiagnDataById
// get report of ad
// getLeadOfYourBussiness
// update lead details
// getLeadDetails

// Sub User in whole api

exports.checkPermissions = async function (requestedPermissions, token) {
  const SECRET_KEY = process.env.JWT_SECRET || "SECRETEKEY";
  const decoded = jwt.verify(token, SECRET_KEY);
  const userData = await userModel.findById(decoded.User).populate("roleId");

  let response = {};

  let error = false;
  requestedPermissions.forEach((reqObj) => {
    let key = Object.keys(reqObj)[0];
    console.log(key);
    let reqPerms = reqObj[key];
    let userObj = userData.roleId.permissions.find((permObj) =>
      permObj.hasOwnProperty(key),
    );
    if (userObj) {
      let userPerms = userObj[key];
      let hasAllPermissions = reqPerms.every((perm) =>
        userPerms.includes(perm),
      );
      if (hasAllPermissions) {
        response[key] = "Access granted";
      } else {
        response[key] = "Access denied";
        error = true;
      }
    } else {
      response[key] = "Access denied";
      error = true;
    }
  });

  if (error) {
    return false;
  } else {
    return true;
  }
};
