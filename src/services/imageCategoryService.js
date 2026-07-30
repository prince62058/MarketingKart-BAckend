const imageCategoryModel = require("../models/imageCategoryModel");

exports.createImageCategoryModel = async (data) => {
  return await imageCategoryModel.create(data);
};

exports.getAllImageCategoryModel = async (query,skip) => {
  return await imageCategoryModel.find(query).skip(skip).sort({createdAt:-1}).limit(20).exec();
};

exports.updateImageCategoryModel = async (id, data) => {
  return await imageCategoryModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableImageCategoryModel = async (getImageCategoryModelById) => {
  return await imageCategoryModel
    .findByIdAndUpdate(
      getImageCategoryModelById?._id,
      { disable: !getImageCategoryModelById.disable },
      { new: true }
    )
    .exec();
};



exports.deleteOneImageCategoryModel = async (query) => {
  return await imageCategoryModel.findByIdAndDelete(query).exec();
};