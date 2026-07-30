const faqModel = require("../models/faqModel");

exports.createFaq = async (data) => {
  return await faqModel.create(data);
};

exports.getAllFaq = async (query,skip) => {
  return await faqModel.find(query).skip(skip).sort({createdAt:-1}).limit(20).exec();
};

exports.updateFaq = async (id, data) => {
  return await faqModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableFaq = async (getFaqById) => {
  return await faqModel
    .findByIdAndUpdate(
      getFaqById?._id,
      { disable: !getFaqById.disable },
      { new: true }
    )
    .exec();
};



exports.deleteOneFaq = async (query) => {
  return await faqModel.findByIdAndDelete(query).exec();
};