const planModel = require("../models/planModel");

exports.createPlan = async (data) => {
  return await planModel.create(data);
};

exports.getAllPlan = async (query, skip, limit = 200) => {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  return await planModel
    .find(query)
    .populate("advertisementTypeId")
    .sort({ price: 1, createdAt: 1 })
    .skip(skip || 0)
    .limit(safeLimit)
    .exec();
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

exports.deletePlan = async (id) => {
  return await planModel.findByIdAndDelete(id).exec();
};
