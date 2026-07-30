const offeringsModel = require("../models/offeringsModel");

exports.createOffering = async (data) => {
  return await offeringsModel.create(data);
};
exports.getAllOffering = async (query,skip) => {
  return await offeringsModel.find(query).skip(skip).populate("planId","title").sort({createdAt:-1}).limit(20).exec();
};

exports.updateOffering = async (id, data) => {
  return await offeringsModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableOffering = async (getOfferingById) => {
  return await offeringsModel
    .findByIdAndUpdate(
      getOfferingById?._id,
      { disable: !getOfferingById.disable },
      { new: true }
    )
    .exec();
};
