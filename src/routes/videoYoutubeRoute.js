const express = require("express");
const router = express.Router();
const videoController = require("../controllers/VideoYoutubeController");

router.post("/createVideo", videoController.createVideo);        // Create
router.get("/getVideos", videoController.getVideos);           // Read All
router.get("/getVideoById", videoController.getVideoById);     // Read One
router.put("/updateVideo", videoController.updateVideo);      // Update
router.delete("/deleteVideo", videoController.deleteVideo);   // Delete

module.exports = router;
