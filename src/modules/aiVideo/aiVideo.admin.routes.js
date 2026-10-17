const express = require("express");
const { authUser, isAdmin } = require("../../middlewares/authMidd");
const asyncHandler = require("../../utils/asyncHandler");
const controller = require("./aiVideo.admin.controller");

const router = express.Router();
// Every route here is admin-only: a signed-in ADMIN account, never just any signed-in user.
const admin = [asyncHandler(authUser), isAdmin];
const base = "/admin/ai-video";

router.get(`${base}/health`, admin, controller.health);
router.get(`${base}/overview`, admin, controller.overview);

router.get(`${base}/videos`, admin, controller.videos);
router.post(`${base}/videos/:studioId/:projectId/refund`, admin, controller.refundVideo);
router.delete(`${base}/videos/:studioId/:projectId`, admin, controller.deleteVideo);

router.get(`${base}/avatars`, admin, controller.avatars);
router.delete(`${base}/avatars/:studioId/:avatarId`, admin, controller.deleteAvatar);

router.get(`${base}/studios`, admin, controller.studios);
router.get(`${base}/studios/:studioId`, admin, controller.studio);
router.post(`${base}/studios/:studioId/credits`, admin, controller.adjustCredits);
router.post(`${base}/studios/:studioId/plan`, admin, controller.setPlan);

router.get(`${base}/orders`, admin, controller.orders);

router.get(`${base}/enterprise`, admin, controller.enterprise);
router.patch(`${base}/enterprise/:studioId`, admin, controller.updateEnterprise);

router.get(`${base}/settings`, admin, controller.settings);
router.put(`${base}/settings`, admin, controller.updateSettings);
router.get(`${base}/audit`, admin, controller.audit);

module.exports = router;
