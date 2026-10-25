const express = require("express");
const controller = require("../controllers/commpanyController");
const {getCompany,updateCompany,toggleMaintenance,updateAppVersion} = require("../controllers/companyControllerV2");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");

// Company settings, maintenance mode and the forced app version drive every phone, so changing them
// takes the COMPANY permission. Reading the company details stays public: the app needs them before login.
const manageCompany = [adminOnly, requirePermission("COMPANY")];

router.post(
  "/createOrUpdateCompany",
  manageCompany,
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
  manageCompany,
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
router.get('/company',getCompany)
router.put('/company',manageCompany,updateCompany)
router.put('/toggleMaintenance',manageCompany,toggleMaintenance)
router.put('/updateAppVersion',manageCompany,updateAppVersion)
module.exports = router;

