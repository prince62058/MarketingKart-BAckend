const Advertisement = require("../models/advertisementModel");

// Create a new advertisement
exports.createAdvertisement = async (advertisementData) => {
  const advertisement = new Advertisement(advertisementData);
  return await advertisement.save();
};

exports.getAllAdvertisements = async (query,skip) => {
  return await Advertisement.find(query).skip(skip).sort({createdAt:-1}).limit(20).exec();
};


// Find all advertisements
exports.getAdvertisementsByType = async (advertisementType) => {
  return await Advertisement.findOne({ _id: advertisementType?._id });
};
// Update an advertisement by ID
exports.updateAdvertisement = async (id, updateData) => {
  return await Advertisement.findByIdAndUpdate(id, updateData, { new: true });
};

// Disable an advertisement by ID
exports.disableAdvertisement = async (id, getAdvertisement) => {
  return await Advertisement.findByIdAndUpdate(
    id,
    { $set: { disable: !getAdvertisement?.disable } },
    { new: true }
  );
};

// Delete an advertisement by ID
exports.deleteAdvertisement = async (id) => {
  return await Advertisement.findByIdAndDelete(id);
};
