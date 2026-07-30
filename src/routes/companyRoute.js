const express = require("express");
const controller = require("../controllers/commpanyController");
const {getCompany,updateCompany,toggleMaintenance,updateAppVersion} = require("../controllers/companyControllerV2");
const router = express.Router();
const { upload } = require("../middlewares/multer");

router.post(
  "/createOrUpdateCompany",
  upload.fields([
    { name: "logo" },
    { name: "banner" }
  ]),
  controller.createOrUpdateCompany
);
router.get('/getCompany',controller.getCompany)

//  V2

router.post(
  "/updateCompany",
  upload.fields([
    { name: "favicon" },
    { name: "logo" },
    { name: "banner1" },
    { name: "banner2" },
    { name: "banner3" },
  ]),
  updateCompany
);
router.get('/getNewCompany',getCompany)
router.put('/toggleMaintenance',toggleMaintenance)
router.put('/updateAppVersion',updateAppVersion)
module.exports = router;
