const cityModel = require("../models/cityModel");

exports.createCity = async (data) => {
  return await cityModel.create(data);
};

exports.getAllCity = async (query,skip) => {
  return await cityModel.find(query).skip(skip).sort({createdAt:-1}).exec();
};

exports.updateCity = async (id, data) => {
  return await cityModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableCity = async (getCityById) => {
  return await cityModel
    .findByIdAndUpdate(
      getCityById?._id,
      { disable: !getCity.disable },
      { new: true }
    )
    .exec();
};


exports.getCityName = async (query) => {
  return await cityModel.findOne(query).exec();
};