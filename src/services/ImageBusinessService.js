const imageBusinessModel = require("../models/ImageBusinessModel");

exports.createImageBusinessModel = async (data) => {
  return await imageBusinessModel.create(data);
};

exports.getAllImageBusinessModel = async (query,skip) => {
  return await imageBusinessModel.find(query).skip(skip).sort({createdAt:-1}).limit(20).exec();
};

exports.updateImageBusinessModel = async (id, data) => {
  return await imageBusinessModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableImageBusinessModel = async (getImageBusinessModelById) => {
  return await imageBusinessModel
    .findByIdAndUpdate(
      getImageBusinessModelById?._id,
      { disable: !getImageBusinessModelById.disable },
      { new: true }
    )
    .exec();
};



exports.deleteOneImageBusinessModel = async (query) => {
  return await imageBusinessModel.findByIdAndDelete(query).exec();
};