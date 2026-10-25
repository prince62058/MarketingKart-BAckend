const express = require('express')
const router = express.Router()
const controller = require('../controllers/simpleVideoController')
const {upload} = require('../middlewares/multer')
const { adminOnly } = require('../middlewares/authMidd')


router.post("/createsimpleVideo", adminOnly, upload.fields([{ name: "thumbnail" }, { name: "video" }]), controller.createsimpleVideo);

router.put("/updatesimpleVideo", adminOnly, upload.fields([{ name: "thumbnail" }, { name: "video" }]), controller.updatesimpleVideo);

router.get("/getsimpleVideo", controller.getsimpleVideo);
router.get("/getAllsimpleVideo", controller.getAllsimpleVideo);

router.delete("/deleteusimpleVideo", adminOnly, controller.deleteusimpleVideo);

module.exports = router;
