const businessModel = require("../models/businessModel");

exports.createBusiness = async (data) => {
  return await businessModel.create(data);
};


exports.getAllBusiness = async (query, skip, limit = 20) => {
  return await businessModel
    .find(query)
    .populate("businessCategoryId")
    .populate("servicesId")
    .populate("userId", "name profileImage phoneNumber")
    .populate("stateId")
    .populate("cityId")
    .populate("statusUpdatedBy", "name image mobile")
    .skip(skip)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
    .exec();
};

exports.getBusinessCount = async (query) => {
  return await businessModel.countDocuments(query);
};

exports.updateBusiness = async (id, data) => {
  return await businessModel.findByIdAndUpdate(id, data, { new: true }).exec();
};

exports.disableBusiness = async (getBusinessById) => {
  return await businessModel
    .findByIdAndUpdate(
      getBusinessById?._id,
      { disable: !getBusinessById.disable },
      { new: true }
    )
    .exec();
};

exports.getAllBusinessByUserId = async (query) => {
  return await businessModel.find({ userId: query?._id }).populate("businessCategoryId userId servicesId stateId cityId").exec();
};

exports.getAllBusinessListForAdmin = async (query, skip, sort, limit = 20) => {
  let sortObj = { createdAt: -1 };
  if (sort == 1) sortObj.createdAt = 1;

  return await businessModel
    .find(query)
    .select(
      "businessName businessImage businessCategoryId isFacebookPageLinked pageId cityId createdAt"
    )
    .skip(skip)
    .sort(sortObj)
    .limit(limit)
    .lean()
    .exec();
};

exports.getBusinessByIdForAdmin = async(businessId)=>{
  
  return await businessModel.findById(businessId).populate("businessCategoryId").exec();
}


