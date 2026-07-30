const express = require('express');
const router = express.Router();
const controller = require('../controllers/ugcVideoController');
const { upload } = require('../middlewares/multer');

router.post(
    "/createugc",
    upload.fields([{ name: "thumbnail" }, { name: "video" }]),
    controller.createugc
);

router.put(
    "/updateugc",
    upload.fields([{ name: "thumbnail" }, { name: "video" }]),
    controller.updateugc
);

router.get("/getugc", controller.getugc);
router.get("/getAllugc", controller.getAllugc);

router.delete("/deleteugc", controller.deleteugc);

module.exports = router;
