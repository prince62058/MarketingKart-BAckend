const faqModel = require("../models/faqModel");

exports.createFaq = async (data) => {
  return await faqModel.create(data);
};

exports.getAllFaq = async (query, skip = 0, limit = 100) => {
  let q = faqModel.find(query).sort({ createdAt: -1 });
  if (skip) q = q.skip(skip);
  if (limit) q = q.limit(limit);
  return await q.exec();
};

exports.countFaqs = async (query = {}) => {
  return await faqModel.countDocuments(query).exec();
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