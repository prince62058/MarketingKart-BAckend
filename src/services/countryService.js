const countryModel = require("../models/countryModel");

exports.createCountry = async (data) => {
  return await countryModel.create(data);
};

exports.getAllCountry = async (query,skip) => {
  return await countryModel.find(query).skip(skip).sort({createdAt:-1}).limit(20).exec();
};

exports.updateCountry = async (id, data) => {
  return await countryModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableCountry = async (getCountryById) => {
  return await countryModel
    .findByIdAndUpdate(
      getCountryById?._id,
      { disable: !getCountryById.disable },
      { new: true }
    )
    .exec();
};



exports.getCountryName = async (query) => {
  return await countryModel.findOne(query).exec();
};