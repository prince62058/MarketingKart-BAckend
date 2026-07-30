const planModel = require("../models/planModel");

exports.createPlan = async (data) => {
  return await planModel.create(data);
};

exports.getAllPlan = async (query,skip) => {
  return await planModel.find(query).populate("advertisementTypeId").skip(skip).sort({createdAt:-1}).limit(20).exec();
};


exports.updatePlan = async (id, data) => {
  return await planModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disablePlan = async (getPlanById) => {
  return await planModel
    .findByIdAndUpdate(
      getPlanById?._id,
      { disable: !getPlanById.disable },
      { new: true }
    )
    .exec();
};
