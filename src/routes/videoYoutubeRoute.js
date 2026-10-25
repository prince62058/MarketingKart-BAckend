const express = require("express");
const router = express.Router();
const videoController = require("../controllers/VideoYoutubeController");
const { adminOnly } = require("../middlewares/authMidd");

router.post("/createVideo", adminOnly, videoController.createVideo);        // Create
router.get("/getVideos", videoController.getVideos);           // Read All
router.get("/getVideoById", videoController.getVideoById);     // Read One
router.put("/updateVideo", adminOnly, videoController.updateVideo);      // Update
router.delete("/deleteVideo", adminOnly, videoController.deleteVideo);   // Delete

module.exports = router;
