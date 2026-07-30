const userRoleModel = require("../models/permissionModel");

exports.createUserRole = async (data) => {
  return await userRoleModel.create(data);
};

exports.getAllUserRole = async (query,skip,limit) => {
  return await userRoleModel
    .find(query)
    .sort({ craetedAt: -1 })
    .skip(skip)
    .limit(limit);
};

exports.roleGetById = async (id) => {
  return await userRoleModel.findById(id);
};

exports.updateUserRole = async (id, data) => {
  console.log(data);
  return await userRoleModel
    .findByIdAndUpdate(id, { $set: data }, { new: true })
    .exec();
};
