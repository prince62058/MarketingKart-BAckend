const ugcModel = require("../models/ugcModel");

// Create a new voice over video
exports.createugc = async (req, res) => {
  try {
    const thumbnail = req.files?.thumbnail?.[0]?.location || null;
    const video = req.files?.video?.[0]?.location || null;
    const newVideo = new ugcModel({ thumbnail, video });
    await newVideo.save();
    res.status(201).json({ success: true, data: newVideo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get a single voice over video by ID
exports.getugc = async (req, res) => {
  try {
    const video = await ugcModel.findById(req.query.videoId);
    if (!video) {
      return res
        .status(404)
        .json({ success: false, message: "Voice over video not found." });
    }
    res.json({ success: true, data: video });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all voice over videos
exports.getAllugc = async (req, res) => {
  try {
    const videos = await ugcModel.find();
    res.json({ success: true, message: "Voice over videos retrieved successfully.", data: videos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update a voice over video by ID
exports.updateugc = async (req, res) => {
  try {
    const data = await ugcModel.findById(req.query.videoId)
    const thumbnail = req.files?.thumbnail?.[0]?.location || data.thumbnail || null;
    const video = req.files?.video?.[0]?.location || data.video || null;
    const updatedVideo = await ugcModel.findByIdAndUpdate(
    req.query.videoId,
      { thumbnail, video },
      { new: true, runValidators: true }
    );
    if (!updatedVideo) {
      return res
        .status(404)
        .json({ success: false, message: "Voice over video not found." });
    }
    res.json({ success: true, message: "Voice over video updated successfully.", data: updatedVideo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a voice over video by ID
exports.deleteugc = async (req, res) => {
  try {
    const deletedVideo = await ugcModel.findByIdAndDelete(req.query.videoId,);
    if (!deletedVideo) {
      return res
        .status(404)
        .json({ success: false, message: "Voice over video not found." });
    }
    res.json({
      success: true,
      message: "Voice over video deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
