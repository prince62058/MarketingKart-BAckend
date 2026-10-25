const express = require('express');
const router = express.Router();
const controller = require('../controllers/ugcVideoController');
const { upload } = require('../middlewares/multer');
const { adminOnly } = require('../middlewares/authMidd');

router.post(
    "/createugc",
    adminOnly,
    upload.fields([{ name: "thumbnail" }, { name: "video" }]),
    controller.createugc
);

router.put(
    "/updateugc",
    adminOnly,
    upload.fields([{ name: "thumbnail" }, { name: "video" }]),
    controller.updateugc
);

router.get("/getugc", controller.getugc);
router.get("/getAllugc", controller.getAllugc);

router.delete("/deleteugc", adminOnly, controller.deleteugc);

module.exports = router;
