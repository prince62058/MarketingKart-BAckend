// WhatsApp super admin (/api/admin/whatsapp/*) and the customer panel's own settings feed
// (/api/whatsapp/panel-config). Admin routes need an ADMIN account with the WA_ADMIN permission.
const express = require("express");
const { authUser, isAdmin } = require("../../middlewares/authMidd");
const { requirePermission } = require("../../middlewares/adminPermission");
const asyncHandler = require("../../utils/asyncHandler");
const service = require("./waAdmin.service");
const controls = require("../../services/whatsappControls");

const router = express.Router();
const admin = [asyncHandler(authUser), isAdmin, requirePermission("WA_ADMIN")];
const base = "/admin/whatsapp";

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error("[wa-admin]", req.method, req.originalUrl, error);
    return res.status(status).json({ success: false, message: status >= 500 ? "Something went wrong" : error.message });
  }
};
const who = (req) => req.authUser || req.user;

router.get(`${base}/overview`, admin, handle(() => service.overview()));
router.get(`${base}/customers`, admin, handle((req) => service.customers(req.query)));
router.get(`${base}/customers/:userId`, admin, handle((req) => service.customer(req.params.userId)));
router.post(`${base}/customers/:userId/wallet`, admin, handle((req) => service.adjustWallet(who(req), req.params.userId, req.body)));
router.post(`${base}/customers/:userId/credits`, admin, handle((req) => service.adjustCredits(who(req), req.params.userId, req.body)));
router.post(`${base}/customers/:userId/plan`, admin, handle((req) => service.grantPlan(who(req), req.params.userId, req.body)));
router.post(`${base}/customers/:userId/plan/extend`, admin, handle((req) => service.extendPlan(who(req), req.params.userId, req.body)));
router.post(`${base}/customers/:userId/plan/cancel`, admin, handle((req) => service.cancelPlan(who(req), req.params.userId, req.body)));
router.get(`${base}/customers/:userId/limits`, admin, handle((req) => service.customerLimits(req.params.userId)));
router.put(`${base}/customers/:userId/controls`, admin, handle((req) => service.setControls(who(req), req.params.userId, req.body)));
router.post(`${base}/customers/:userId/keys/:keyId/revoke`, admin, handle((req) => service.revokeKey(who(req), req.params.userId, req.params.keyId)));
router.put(`${base}/customers/:userId/api-package`, admin, handle((req) => service.saveApiPackage(who(req), req.params.userId, req.body)));
router.get(`${base}/plans`, admin, handle(() => service.planOptions()));
router.get(`${base}/messages`, admin, handle((req) => service.messages(req.query)));
router.get(`${base}/numbers`, admin, handle((req) => service.numbers(req.query)));
router.get(`${base}/numbers/:userId`, admin, handle((req) => service.numberDetail(req.params.userId)));
router.post(`${base}/numbers/:userId/refresh`, admin, handle((req) => service.refreshFromMeta(req.user, req.params.userId)));
router.get(`${base}/integrations`, admin, handle((req) => service.integrations(req.query)));
router.get(`${base}/api`, admin, handle((req) => service.apiUsage(req.query)));
router.get(`${base}/panel`, admin, handle(() => service.panelSettings()));
router.put(`${base}/panel`, admin, handle((req) => service.savePanelSettings(who(req), req.body)));
router.get(`${base}/audit`, admin, handle((req) => service.audit(req.query)));

// The signed-in customer's own view: features, suspension, announcement and menu.
router.get("/whatsapp/panel-config", asyncHandler(authUser), handle((req) => controls.panelConfig(req.user._id)));

module.exports = router;
