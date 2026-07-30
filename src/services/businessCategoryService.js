const categoryModel = require("../models/businessCategoryModel");

exports.createCategory = async (data) => {
  return await categoryModel.create(data);
};

exports.getAllCategory = async (query,skip,sort) => {
  return await categoryModel.find(query).skip(skip).populate("categoryId").sort({createdAt:-1}).limit(20).exec();
};

exports.updateCategory = async (id, data) => {
  return await categoryModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableCategory = async (getBusinessById) => {
  return await categoryModel
    .findByIdAndUpdate(
      getBusinessById?._id,
      { disable: !getBusinessById.disable },
      { new: true }
    )
    .exec();
};
