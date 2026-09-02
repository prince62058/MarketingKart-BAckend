const express = require("express");
const controller = require("../controllers/adsDetailsController");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

// router.post('/adsDetails/addCreativeImg',upload.single('filename'),controller.addCreativeImg)

router.post(
  "/adsDetails/createAdsDetails",
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
  controller.ai
);
  router.put(
    "/pusedAd",
    controller.pusedAd
  );
    router.put(
    "/updateAddAmountInsights",
    controller.updateAddAmountInsights
  );
router.put(
  "/resetAd",
  controller.resetAd
);
router.post(
  "/imageVideoUpload",
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
router.post("/scheduleDeliveryOfAdd", controller.scheduleDeliveryOfAdd);

router.get("/searchTargetArea", controller.targetingLocation);
router.get("/targetingInterest", controller.targetingInterest);
router.get("/adsDetails/syncLiveSpend", controller.syncLiveSpend);
router.get("/forDemoAd", controller.forDemoAd);
router.put("/updateMetaAdsId", controller.updateMetaAdsId);
router.put("/updateInternalCampaignStatus", controller.updateInternalCampaignStatus);
router.get("/getMetaAdAccountCampaigns", controller.getMetaAdAccountCampaigns);
// router.get("/getTotalAdsAmount", controller.getTotalAdsAmount);
module.exports = router;
