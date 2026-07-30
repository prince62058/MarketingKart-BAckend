const express = require('express')
const router = express.Router()
const controller = require('../controllers/voiceOverVideoController')
const {upload} = require('../middlewares/multer')

router.post(
  "/createVoiceOverVideo",
  upload.fields([{ name: "thumbnail" }, { name: "video" }]),
  controller.createVoiceOverVideo
);

router.put(
  "/updateVoiceOverVideo",
  upload.fields([{ name: "thumbnail" }, { name: "video" }]),
  controller.updateVoiceOverVideo
);

router.get("/getVoiceOverVideo", controller.getVoiceOverVideo);
router.get("/getAllVoiceOverVideos", controller.getAllVoiceOverVideos);

router.delete("/deleteVoiceOverVideo", controller.deleteVoiceOverVideo);

module.exports = router;
