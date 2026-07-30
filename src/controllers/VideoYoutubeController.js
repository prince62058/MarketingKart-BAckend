const { messaging } = require("firebase-admin");
const Video = require("../models/videoYoutubeModel");

// Create Video
exports.createVideo = async (req, res) => {
    try {
        const { title, url } = req.body;
        const video = new Video({ title, url });
        await video.save();
        res.status(201).json({ success: true, message: "Video created successfully", data: video });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Videos
exports.getVideos = async (req, res) => {
    try {
        const videos = await Video.find();
        res.status(200).json({ success: true, message: "video fatch successfully", data: videos });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Single Video
exports.getVideoById = async (req, res) => {
    try {
        const video = await Video.findById(req.query.videoId);
        if (!video) return res.status(404).json({ success: false, message: "Video not found" });
        res.status(200).json({ success: true, message: "video fatch successfully", data: video });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Video
exports.updateVideo = async (req, res) => {
  try {
    const { title, url } = req.body;
    const video = await Video.findByIdAndUpdate(
      req.query.videoId,
      { $set: { title, url } }, // Use $set to update only provided fields
      { new: true, runValidators: true } // Ensure validators are applied
    );
    if (!video) {
      return res.status(404).json({ success: false, message: "Video not found" });
    }
    res.status(200).json({ success: true, message: "Video updated successfully", data: video });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating video", error: error.message });
  }
};
// Delete Video
exports.deleteVideo = async (req, res) => {
    try {
        const video = await Video.findByIdAndDelete(req.query.videoId);
        if (!video) return res.status(404).json({success:false, message: "Video not found" });
        res.status(200).json({ success:true,message: "Video deleted successfully" });
    } catch (error) {
        res.status(500).json({success: false, message: error.message});
    }
};
