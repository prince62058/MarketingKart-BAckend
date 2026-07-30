const {
  statusCodes,
  defaultResponseMessage,
  apiResponseStatusCode,
} = require("../Message/defaultMessage");
const userRoleService = require("../services/userRoleService");
const responseBuilder = require("../utils/responseBuilder");
const userRoleModel = require("../models/permissionModel");
const { checkPermissions } = require("../helpers/checkPermission");
// const businessManagerUserModel = require("../models/businessManagerUser");
// const businessUserAssetsModel = require("../models/businessUserAssetsModel");

exports.createUserRole = async (req, res) => {
  let { roleName, permissions, businessId,memberId } = req.body;
  const token = req.headers["authorization"];
 if(permissions.length>1){
  return res.status(400).send({success:false,message:"permission must be less than 2"})
 }
  const dataObj = {
    roleName,
    permissions,
    businessId,
    userId:memberId,
  };
  const obj = {
    roleName: roleName,
    businessId: businessId,
  };

  let findCheck = await userRoleModel.findOne(obj);
  if (findCheck) {
    return res
      .status(statusCodes.Created)
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          "You Have Already Same Role Don't Create "
        )
      );
  }
  let data = await userRoleService.createUserRole(dataObj);
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

exports.getAllRole = async (req, res) => {
  try {
    const { businessId, page = 1, limit = 20 } = req.query;
    const token = req.headers["authorization"];
    let requestedPermissions = [
      { "Roles&Permission": ["read"] },
      // { "Leads": [ "write"] },
      // { "Ads": ["read"] }
    ];

    // Uncomment and use this block if you need permission check.
    // let checkPermission = await checkPermissions(requestedPermissions, token);
    // if (!checkPermission) {
    //   return res
    //     .status(400)
    //     .send({ success: false, message: "Access denied" });
    // }

    let obj = {};
    if (businessId) {
      obj.businessId = businessId;
    }

    let skip = (page - 1) * limit;

    let data = await userRoleService.getAllUserRole(obj, skip, limit);

    const totalCount = (await userRoleService.getAllUserRole()).length;
    const pageCount = Math.ceil(totalCount / limit);

    return res.status(200).send({
      success: true,
      message: "Get all roles successfully",
      data: data,
      pageCount,
      currentPage: parseInt(page),
    });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.getRoleById = async (req, res) => {
  const { roleId } = req.query;
  const data = await userRoleService.roleGetById(roleId);
  return res
    .status(200)
    .send({ success: true, message: "role get by id ", data: data });
};

exports.updateUserRole = async (req, res) => {
  const token = req.headers["authorization"];
  const { roleId } = req.query;
  let requestedPermissions = [
    { "Roles&Permission": ["write"] },
    // { "Leads": [ "write"] },
    // { "Ads": ["read"] }
  ];
  // let checkPermission =   await checkPermissions(requestedPermissions,token)
  // if(!checkPermission){
  //   return res
  //   .status(400)
  //   .send({ success: false, message: "Access denied"});
  // }
  const { roleName, permissionsName, businessId ,memberId} = req.body;
  let obj = {
    roleName,
    permissionsName,
    businessId,
    memberId
  };
  const obj2 = {
    roleName: roleName,
  };
  let findCheck = await userRoleModel.findOne(obj2);

  if (findCheck && findCheck?.businessId == businessId.toString()) {
    return res
      .status(statusCodes.Created)
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          "You Have Already Same Role Don't Update"
        )
      );
  }

  let data = await userRoleService.updateUserRole({ _id: roleId }, obj);

  // let check = await businessManagerUserModel.findOne({
  //   businessId: data.businessId,
  //   userId: userId,
  // });
  // if (!check) {
  //   await businessManagerUserModel.create({
  //     businessId: data.businessId,
  //     userId: userId,
  //     accessLevel: "EMPLOYEE",
  //   });
  // }
  // console.log("userId", userId);
  // // let checkAssests = await businessUserAssetsModel.findOne({
  // //   userId: userId,
  // //   businessId: businessId,
  // // });
  // // console.log(data.permissions[0].business);
  // let allKeys = Object.keys(data.permissions[0]);
  // if(allKeys.length){
  //   if (allKeys.includes("business")) {
  //     await businessUserAssetsModel.findOneAndUpdate(
  //       { userId: userId, businessId: data.businessId , assetType:"BUSINESS" },
  //       {
  //         $set: {
  //           businessId: data.businessId,
  //           userId: userId,
  //           roleId: data._id,
  //           assetType: "BUSINESS",
  //           roleType: data.permissions[0].business,
  //         },
  //       },
  //       {
  //         new:true,
  //         upsert: true,
  //       }
  //     );
  //   }
  //   if (allKeys.includes("leads")) {
  //     await businessUserAssetsModel.findOneAndUpdate(
  //       { userId: userId, businessId: data.businessId,assetType:'LEAD' },
  //       {
  //         $set: {
  //           businessId: data.businessId,
  //           userId: userId,
  //           roleId: data._id,
  //           assetType: "LEAD",
  //           roleType: data.permissions[0].leads,
  //         },
  //       },
  //       {
  //         new:true,
  //         upsert: true,
  //       }
  //     );
  //   }
  //   if (allKeys.includes("ads")) {
  //     await businessUserAssetsModel.findOneAndUpdate(
  //       { userId: userId, businessId: data.businessId,assetType:"ADS" },
  //       {
  //         $set: {
  //           businessId: data.businessId,
  //           userId: userId,
  //           roleId: data._id,
  //           assetType: "ADS",
  //           roleType: data.permissions[0].ads,
  //         },
  //       },
  //       {
  //         new:true,
  //         upsert: true,
        
  //       }
  //     );
  //   }
  // }
  
  return res
    .status(200)
    .send({ success: true, message: "role update successfully", data: data });
};


exports.assignPermssionsToUser = async (req, res) => {
  const {  permissions, businessId,memberId } = req.body;
  
 let data = await userRoleModel.findOneAndUpdate(
  {userId:memberId,businessId:businessId},
  {
    $set:{
      businessId:businessId,
      userId:memberId,
      permissions:permissions
    }
  },
  {
    upsert:true,
    new:true
  }
 )
  return res
    .status(200)
    .send({ success: true, message: "role update successfully", data: data });
};
