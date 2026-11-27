const express = require("express");
const controller = require("../controllers/businessController");
const router = express.Router();
const { businessMid } = require("../middlewares/bussinessMidd");
const { userMid } = require("../middlewares/userMidd");
const { upload } = require("../middlewares/multer");
const { authUser, adminOnly } = require("../middlewares/authMidd");
const { requireBusinessAccess } = require("../middlewares/businessAccessMidd");
const asyncHandler = require("../utils/asyncHandler");
const { staffMid } = require("../middlewares/staffMidd");

router.post(
  "/business/createBussiness",
  asyncHandler(authUser),
  upload.single("businessImage"),
  asyncHandler(controller.createBusiness)
);

router.get(
  "/business/getAllBussiness",
  adminOnly,
  asyncHandler(controller.getAllBusiness)
);
router.get(
  "/business/getAllBussinessByUserId/:userId",
  asyncHandler(authUser),
  asyncHandler(userMid),
  asyncHandler(controller.getAllBusinessByUserId)
);

router.get(
  "/business/getByIdBussiness/:businessId",
  asyncHandler(authUser),
  requireBusinessAccess("params", "businessId"),
  asyncHandler(businessMid),
  asyncHandler(controller.getByIdBusiness)
);
router.put(
  "/business/updateBussiness/:businessId",
  asyncHandler(authUser),
  requireBusinessAccess("params", "businessId"),
  asyncHandler(businessMid),
  upload.single("businessImage"),
  asyncHandler(controller.updateBusiness)
);
router.put(
  "/business/disableBussiness/:businessId",
  adminOnly,
  asyncHandler(businessMid),
  asyncHandler(controller.disableBusiness)
);
router.put(
  "/business/unLinkPage",
  asyncHandler(authUser),
  asyncHandler(controller.unLinkPage)
);
router.post(
  "/business/unLinkPage",
  asyncHandler(authUser),
  asyncHandler(controller.unLinkPage)
);

router.get(
  "/business/getBusinessIdForAdmin",
  adminOnly,
  asyncHandler(controller.getBusinessIdForAdmin)
);

router.get(
  "/business/getBusinessListForAdmin",
  adminOnly,
  asyncHandler(controller.getBusinessListForAdmin)
);

router.get(
  "/business/getUsersAllBusinessList",
  asyncHandler(authUser),
  asyncHandler(controller.getUsersAllBusinessList)
);

router.put(
  "/business/updateBusinessStatus",
  adminOnly,
  asyncHandler(controller.updateBusinessStatus)
);

router.put(
  "/business/addBusinessFollowUp",
  adminOnly,
  asyncHandler(controller.addBusinessFollowUp)
);

router.delete(
  "/business/deleteBusinessFollowUp",
  adminOnly,
  asyncHandler(controller.deleteBusinessFollowUp)
);

router.put(
  "/business/assignBusiness",
  adminOnly,
  asyncHandler(controller.assignBusiness)
);

router.delete(
  "/business/deleteBusiness",
  adminOnly,
  asyncHandler(controller.deleteBusiness)
);

router.post(
  "/business/linkMetaAd",
  adminOnly,
  asyncHandler(controller.linkMetaAd)
);

router.post(
  "/business/repairFacebookPageLink",
  asyncHandler(authUser),
  requireBusinessAccess("body", "businessId"),
  asyncHandler(controller.repairFacebookPageLink)
);

router.post(
  "/business/forceLinkFacebookPage",
  adminOnly,
  asyncHandler(controller.forceLinkFacebookPage)
);

module.exports = router;
