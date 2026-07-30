const User = require("../models/userModel");

// Create a new User
exports.mobileLogIn = async (UserData) => {
  const Users = new User(UserData);
  return await Users.save();
};

exports.getAllUsers = async (obj,skip) => {
  return await User.find(obj).skip(skip).sort({createdAt:-1}).populate("userRole").limit(20).exec();
};

// Update an User by ID
exports.updateUser = async (id, updateData) => {
  return await User.findByIdAndUpdate(id, updateData, { new: true });
};

// Disable an User by ID
exports.disableUser = async (id, getUser) => {
  return await User.findByIdAndUpdate(
    id?._id,
    { $set: { disable: !id?.disable } },
    { new: true }
  );
};

exports.finOne = async (find, updateData) => {
  return await User.findOneAndUpdate(
    find ,
    { $set: updateData },
    { new: true }
  ).populate("userRole").populate("businessId", "businessName businessImage");
};


exports.checkData = async (find, ) => {
  return await User.findOne(
    find 
  );
};