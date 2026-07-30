const aiImagePlanModel = require("../models/aiImagePlanModel")

exports.createAiImagePlan = async (data) => {
  return await aiImagePlanModel.create(data);
};

exports.getAllAiImagePlan = async (obj,skip) => {
  return await aiImagePlanModel.find(obj).skip(skip).sort({createdAt:-1}).limit(20).exec()
};