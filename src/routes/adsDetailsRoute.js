const express = require("express");
const controller = require("../controllers/adsDetailsController");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { authUser, isAdmin } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const { requireDeliveryAccess } = require("../middlewares/adCampaignAccess");
router.post("/ads/review", asyncHandler(authUser), isAdmin, require("../controllers/adApprovalController").review);

// router.post('/adsDetails/addCreativeImg',upload.single('filename'),controller.addCreativeImg)

router.post(
  "/adsDetails/createAdsDetails",
  asyncHandler(authUser),
  upload.single("filename"),
  controller.createAdSetDefineBudgetAndDuration
);
router.get(
  "/adsDetail",
  controller.adsDetail
);
router.get(
  "/getInternalCampiagnByIdByAdmin",
  controller.getInternalCampiagnByIdByAdmin
);
router.post(
  "/ai",
  asyncHandler(authUser),
  controller.ai
);
  router.put(
    "/pusedAd",
    asyncHandler(authUser), asyncHandler(requireDeliveryAccess),
    controller.pusedAd
  );
    router.put(
    "/updateAddAmountInsights",
    asyncHandler(authUser), isAdmin, asyncHandler(requireDeliveryAccess),
    controller.updateAddAmountInsights
  );
router.put(
  "/resetAd",
    asyncHandler(authUser), asyncHandler(requireDeliveryAccess),
  controller.resetAd
);
router.post(
  "/imageVideoUpload",
   asyncHandler(authUser),
   upload.fields([{ name: "thumbnail" }, { name: "files" }]),
  controller.imageVideoUpload
);

router.get(
  "/getReachEstimats",
  controller.getAdEstimate
);
router.get(
  "/getAllAdPreviews",
  controller.getAllAdPreviews
);
router.get(
  "/getAllMyAdsListApi",
  // asyncHandler(authUser),
  controller.getAllAdsList
);
router.get(
  "/getAllAdsListByAdmin",
  // asyncHandler(authUser),
  controller.getAllAdsListByAdmin
);
router.get(
  "/getAdReport",
  asyncHandler(authUser),
  controller.getAdvertismentReport
);
router.get(
  "/getInternalCampiagnDataById",
  asyncHandler(authUser),
  controller.getInternalCampiagnById
);
router.get(
  "/getAdInsightsReport",
  asyncHandler(authUser),
  controller.getAdInsightsReport
);
router.post("/scheduleDeliveryOfAdd", asyncHandler(authUser), asyncHandler(requireDeliveryAccess), controller.scheduleDeliveryOfAdd);

router.get("/searchTargetArea", asyncHandler(authUser), controller.targetingLocation);
router.get("/targetingInterest", controller.targetingInterest);
router.get("/adsDetails/syncLiveSpend", controller.syncLiveSpend);
router.get("/forDemoAd", controller.forDemoAd);
router.put("/updateMetaAdsId", asyncHandler(authUser), isAdmin, asyncHandler(requireDeliveryAccess), controller.updateMetaAdsId);
router.put("/updateInternalCampaignStatus", asyncHandler(authUser), isAdmin, asyncHandler(requireDeliveryAccess), controller.updateInternalCampaignStatus);
router.get("/getMetaAdAccountCampaigns", controller.getMetaAdAccountCampaigns);
// router.get("/getTotalAdsAmount", controller.getTotalAdsAmount);
module.exports = router;
