const GstOfUserModel = require("../models/GstOfUserModel");

const callerOf = (req) => req.authUser || req.user;
const isAdminCaller = (req) => callerOf(req)?.userType === "ADMIN";
// A GST record belongs to the user it names; only that user or an admin may touch it.
const ownsRecord = (req, record) => isAdminCaller(req) || String(record?.userId) === String(callerOf(req)?._id);

// Create a new GstOfUserModel entry
exports.createGstOfUser = async (req, res) => {
  try {
    const GstOfUser = new GstOfUserModel(isAdminCaller(req) ? req.body : { ...req.body, userId: callerOf(req)._id });
    const saved = await GstOfUser.save();
    res
      .status(201)
      .json({ success: true, message: "Gst Create Successfully", data: saved });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all GstOfUserModeles
exports.getGstOfUserModeles = async (req, res) => {
  try {
    const GstOfUserModeles = await GstOfUserModel.find().populate("city").populate("state");
    res.status(200).json({
      success: true,
      message: "Gst User Fatch Successfully.",
      data: GstOfUserModeles,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get one GstOfUserModel by GST number
exports.getGstOfUserModelByGst = async (req, res) => {
  try {
    const { gstNumberId } = req.query;
    const GstOfUser = await GstOfUserModel.findById(gstNumberId).populate("city").populate("state");
    if (!GstOfUser || !ownsRecord(req, GstOfUser))
      return res
        .status(404)
        .json({ success: false, message: "GstOfUser not found" });
    res.status(200).json({
      success: true,
      message: "Gst Fatch Successfully.",
      data: GstOfUser,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getGstOfUserByUserId = async (req, res) => {
  try {
    const userId = isAdminCaller(req) ? req.query.userId : String(callerOf(req)._id);
    const GstOfUser = await GstOfUserModel.findOne({ userId }).populate("city").populate("state");
    if (!GstOfUser) {
      return res.status(200).json({ success: true, message: "GstOfUser not found", data: null });
    }
    res.status(200).json({
      success: true,
      message: "Gst Fatch Successfully.",
      data: GstOfUser,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Update GstOfUserModel by GST number
exports.updateGstOfUserModelByGst = async (req, res) => {
  try {
    const { gstNumberId } = req.query;
    const existing = await GstOfUserModel.findById(gstNumberId);
    if (existing && !ownsRecord(req, existing)) {
      return res
        .status(404)
        .json({ success: false, message: "GstOfUserModel not found" });
    }
    // The owner of a record is not something an update may change.
    const changes = isAdminCaller(req) ? req.body : { ...req.body, userId: existing?.userId };
    const updatedGstOfUserModel = await GstOfUserModel.findByIdAndUpdate(
      { _id: gstNumberId },
      changes,
      { new: true, runValidators: true }
    ).populate("city").populate("state");

    if (!updatedGstOfUserModel) {
      return res
        .status(404)
        .json({ success: false, message: "GstOfUserModel not found" });
    }

    res.status(200).json({
      succes: true,
      message: "Update Successfully.",
      data: updatedGstOfUserModel,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
