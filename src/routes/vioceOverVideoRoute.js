const express = require('express')
const router = express.Router()
const controller = require('../controllers/voiceOverVideoController')
const {upload} = require('../middlewares/multer')
const { adminOnly } = require('../middlewares/authMidd')

router.post(
  "/createVoiceOverVideo",
  adminOnly,
  upload.fields([{ name: "thumbnail" }, { name: "video" }]),
  controller.createVoiceOverVideo
);

router.put(
  "/updateVoiceOverVideo",
  adminOnly,
  upload.fields([{ name: "thumbnail" }, { name: "video" }]),
  controller.updateVoiceOverVideo
);

router.get("/getVoiceOverVideo", controller.getVoiceOverVideo);
router.get("/getAllVoiceOverVideos", controller.getAllVoiceOverVideos);

router.delete("/deleteVoiceOverVideo", adminOnly, controller.deleteVoiceOverVideo);

module.exports = router;
