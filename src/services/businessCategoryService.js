const categoryModel = require("../models/businessCategoryModel");

exports.createCategory = async (data) => {
  return await categoryModel.create(data);
};

exports.getAllCategory = async (query, skip = 0, sort = { orderNumber: 1, createdAt: -1 }, limit = 100) => {
  let queryBuilder = categoryModel.find(query).populate("categoryId");
  if (sort) queryBuilder = queryBuilder.sort(sort);
  if (skip) queryBuilder = queryBuilder.skip(skip);
  if (limit) queryBuilder = queryBuilder.limit(limit);
  return await queryBuilder.exec();
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
