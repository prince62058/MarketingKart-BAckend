const { authUser, isAdmin } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

const express = require("express");
const controller = require("../controllers/adminDashboard");
const router = express.Router();

router.get('/DashBoardApiAdmin',controller.DashBoardApiAdmin)
router.get('/dashBoardGraphsAndCharts',controller.dashBoardGraphsAndCharts)
router.get('/userListForAdmin',controller.userListForAdmin)
router.get('/adListForAdmin',asyncHandler(authUser),isAdmin,controller.adListForAdmin)
router.get('/adbyIdForAdmin',controller.adbyIdForAdmin)
router.get('/permanentToken',controller.permanentToken)
router.get('/getAdsWithErrors',controller.getAdsWithErrors)
router.get('/getAdsWithErrorsByid',controller.getAdsWithErrorsByid)
router.post('/refreshMetaToken',controller.refreshMetaToken)
router.post('/updateMetaToken',controller.updateMetaToken)
router.get('/checkMetaTokenStatus',controller.checkMetaTokenStatus)
router.get('/liveAdsStatus',controller.liveAdsStatus)
router.get('/getUnlinkedMetaCampaigns', controller.getUnlinkedMetaCampaigns)
router.post('/linkMetaAdToCampaign', asyncHandler(authUser), isAdmin, controller.linkMetaAdToCampaign)
module.exports = router;
