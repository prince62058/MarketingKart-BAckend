const express = require("express");
const { authUser } = require("../middlewares/authMidd");
const { staffPermission } = require("../middlewares/adminPermission");
const rcsController = require("../controllers/rcsController");
const rcsPlanController = require("../controllers/rcsPlanController");

const router = express.Router();

router.get("/rcs/provider", authUser, rcsController.getProvider);
// There is no RCS billing yet, so each customer gets a fixed number of sends per hour (each send
// is still capped by the admin's maxSendBatch); admins are not limited.
const rcsCustomerLimit = require("../middlewares/rateLimit").rateLimit({ name: "rcs-send", windowMs: 60 * 60 * 1000, max: 30, key: (req) => req.user?._id, message: "RCS send limit reached. Try again in an hour." });
function rcsCustomerSend(req, res, next) {
  if (req.user?.userType === "ADMIN") return next();
  if (req.body?.imageUrl !== undefined && !/^https:\/\//i.test(String(req.body.imageUrl))) {
    return res.status(400).json({ success: false, message: "Use an https:// image link." });
  }
  return rcsCustomerLimit(req, res, next);
}
router.post("/rcs/send", authUser, rcsCustomerSend, rcsController.sendImageTemplate);

router.get("/rcs/catalog", authUser, rcsPlanController.getCatalog);

router.post("/rcs/plans", authUser, staffPermission("RCS_PLANS"), rcsPlanController.createPlan);
router.get("/rcs/plans", authUser, rcsPlanController.getPlans);
router.put("/rcs/plans/:planId", authUser, staffPermission("RCS_PLANS"), rcsPlanController.updatePlan);
router.put("/rcs/plans/:planId/toggle", authUser, staffPermission("RCS_PLANS"), rcsPlanController.togglePlan);

router.get("/rcs/settings", authUser, rcsPlanController.getSettings);
router.put("/rcs/settings", authUser, staffPermission("RCS_PLANS"), rcsPlanController.updateSettings);

module.exports = router;
