const { authUser, isAdmin, adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const asyncHandler = require("../utils/asyncHandler");

const express = require("express");
const controller = require("../controllers/adminDashboard");
const router = express.Router();

// The dashboard is open to every admin/staff; the other pages are limited by the same permission codes the
// panel uses to hide them. The Meta token endpoints change or reveal platform-wide credentials, so they
// need the COMPANY permission.
router.get('/DashBoardApiAdmin',adminOnly,controller.DashBoardApiAdmin)
router.get('/dashBoardGraphsAndCharts',adminOnly,controller.dashBoardGraphsAndCharts)
router.get('/userListForAdmin',adminOnly,requirePermission('USERS'),controller.userListForAdmin)
router.get('/adListForAdmin',asyncHandler(authUser),isAdmin,requirePermission('ADS'),controller.adListForAdmin)
router.get('/adbyIdForAdmin',adminOnly,requirePermission('ADS'),controller.adbyIdForAdmin)
router.get('/permanentToken',adminOnly,requirePermission('COMPANY'),controller.permanentToken)
router.get('/getAdsWithErrors',adminOnly,requirePermission('ADS'),controller.getAdsWithErrors)
router.get('/getAdsWithErrorsByid',adminOnly,requirePermission('ADS'),controller.getAdsWithErrorsByid)
router.post('/refreshMetaToken',adminOnly,requirePermission('COMPANY'),controller.refreshMetaToken)
router.post('/updateMetaToken',adminOnly,requirePermission('COMPANY'),controller.updateMetaToken)
router.get('/checkMetaTokenStatus',adminOnly,requirePermission('COMPANY'),controller.checkMetaTokenStatus)
router.get('/liveAdsStatus',adminOnly,requirePermission('ADS'),controller.liveAdsStatus)
router.get('/getUnlinkedMetaCampaigns',adminOnly,requirePermission('ADS'),controller.getUnlinkedMetaCampaigns)
router.post('/linkMetaAdToCampaign', asyncHandler(authUser), isAdmin, requirePermission('ADS'), controller.linkMetaAdToCampaign)
module.exports = router;
