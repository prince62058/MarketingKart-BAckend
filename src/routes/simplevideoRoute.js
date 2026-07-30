const express = require('express')
const router = express.Router()
const controller = require('../controllers/simpleVideoController')
const {upload} = require('../middlewares/multer')


router.post("/createsimpleVideo", upload.fields([{ name: "thumbnail" }, { name: "video" }]), controller.createsimpleVideo);

router.put("/updatesimpleVideo", upload.fields([{ name: "thumbnail" }, { name: "video" }]), controller.updatesimpleVideo);

router.get("/getsimpleVideo", controller.getsimpleVideo);
router.get("/getAllsimpleVideo", controller.getAllsimpleVideo);

router.delete("/deleteusimpleVideo", controller.deleteusimpleVideo);

module.exports = router;
