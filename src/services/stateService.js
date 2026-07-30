const stateModel = require("../models/stateModel");

exports.createState = async (data) => {
  return await stateModel.create(data);
};

exports.getAllState = async (query,skip) => {
  return await stateModel.find(query).skip(skip).sort({createdAt:-1}).exec();
};



exports.updateState = async (id, data) => {
  return await stateModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableState = async (getStateById) => {
  return await stateModel
    .findByIdAndUpdate(
      getStateById?._id,
      { disable: !getState.disable },
      { new: true }
    )
    .exec();
};



exports.getStateName = async (query) => {
  return await stateModel.findOne(query).exec();
};