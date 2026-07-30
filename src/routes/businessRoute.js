const express = require("express");
const controller = require("../controllers/businessController");
const router = express.Router();
const { businessMid } = require("../middlewares/bussinessMidd");
const { userMid } = require("../middlewares/userMidd");
const { upload } = require("../middlewares/multer");
const { authUser } = require("../middlewares/authMidd");
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
  // asyncHandler(authUser),
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
  asyncHandler(businessMid),
  asyncHandler(controller.getByIdBusiness)
);
router.put(
  "/business/updateBussiness/:businessId",
 // asyncHandler(authUser),
  asyncHandler(businessMid),
  upload.single("businessImage"),
  asyncHandler(controller.updateBusiness)
);
router.put(
  "/business/disableBussiness/:businessId",
  asyncHandler(authUser),
  asyncHandler(businessMid),
  asyncHandler(controller.disableBusiness)
);
router.put(
  "/business/unLinkPage",
  asyncHandler(controller.unLinkPage)
);

router.get(
  "/business/getBusinessIdForAdmin",
  asyncHandler(authUser),
  asyncHandler(controller.getBusinessIdForAdmin)
);

router.get(
  "/business/getBusinessListForAdmin",
  asyncHandler(authUser),
  asyncHandler(controller.getBusinessListForAdmin)
);

router.get(
  "/business/getUsersAllBusinessList",
  asyncHandler(authUser),
  asyncHandler(controller.getUsersAllBusinessList)
);

router.put(
  "/business/updateBusinessStatus",
  asyncHandler(authUser),
  asyncHandler(controller.updateBusinessStatus)
);

router.put(
  "/business/addBusinessFollowUp",
  asyncHandler(authUser),
  asyncHandler(controller.addBusinessFollowUp)
);

router.delete(
  "/business/deleteBusinessFollowUp",
  asyncHandler(authUser),
  asyncHandler(controller.deleteBusinessFollowUp)
);

router.put(
  "/business/assignBusiness",
  asyncHandler(authUser),
  asyncHandler(controller.assignBusiness)
);

router.delete(
  "/business/deleteBusiness",
  asyncHandler(authUser),
  asyncHandler(controller.deleteBusiness)
);

router.post(
  "/business/linkMetaAd",
  asyncHandler(authUser),
  asyncHandler(controller.linkMetaAd)
);

router.post(
  "/business/repairFacebookPageLink",
  asyncHandler(authUser),
  asyncHandler(controller.repairFacebookPageLink)
);

router.post(
  "/business/forceLinkFacebookPage",
  asyncHandler(authUser),
  asyncHandler(controller.forceLinkFacebookPage)
);

module.exports = router;
