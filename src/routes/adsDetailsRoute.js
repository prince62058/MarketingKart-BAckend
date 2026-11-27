const express = require("express");
const controller = require("../controllers/adsDetailsController");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { authUser, isAdmin, adminOnly } = require("../middlewares/authMidd");
const { requireBusinessAccess, requireCampaignAccess } = require("../middlewares/businessAccessMidd");
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
  asyncHandler(authUser),
  requireCampaignAccess("query", "adId"),
  controller.adsDetail
);
router.get(
  "/getInternalCampiagnByIdByAdmin",
  adminOnly,
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
// Admin only: the old self-serve renewal charged a client-sent amount. Customers renew through a new ad request.
router.put(
  "/resetAd",
    asyncHandler(authUser), isAdmin, asyncHandler(requireDeliveryAccess),
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
  asyncHandler(authUser),
  controller.getAdEstimate
);
router.get(
  "/getAllAdPreviews",
  asyncHandler(authUser),
  controller.getAllAdPreviews
);
router.get(
  "/getAllMyAdsListApi",
  asyncHandler(authUser),
  requireBusinessAccess("query", "businessId"),
  controller.getAllAdsList
);
router.get(
  "/getAllAdsListByAdmin",
  adminOnly,
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
  requireCampaignAccess("query", "internalCampaignId"),
  controller.getInternalCampiagnById
);
router.get(
  "/getAdInsightsReport",
  asyncHandler(authUser),
  requireCampaignAccess("query", "internalCampaignId"),
  controller.getAdInsightsReport
);
router.post("/scheduleDeliveryOfAdd", asyncHandler(authUser), isAdmin, asyncHandler(requireDeliveryAccess), controller.scheduleDeliveryOfAdd);

router.get("/searchTargetArea", asyncHandler(authUser), controller.targetingLocation);
router.get("/targetingInterest", asyncHandler(authUser), controller.targetingInterest);
router.get("/adsDetails/syncLiveSpend", asyncHandler(authUser), requireBusinessAccess("query", "businessId"), controller.syncLiveSpend);
router.get("/forDemoAd", asyncHandler(authUser), controller.forDemoAd);
router.put("/updateMetaAdsId", asyncHandler(authUser), isAdmin, asyncHandler(requireDeliveryAccess), controller.updateMetaAdsId);
router.put("/updateInternalCampaignStatus", asyncHandler(authUser), isAdmin, asyncHandler(requireDeliveryAccess), controller.updateInternalCampaignStatus);
router.get("/getMetaAdAccountCampaigns", asyncHandler(authUser), requireBusinessAccess("query", "businessId"), controller.getMetaAdAccountCampaigns);
// router.get("/getTotalAdsAmount", controller.getTotalAdsAmount);
module.exports = router;
