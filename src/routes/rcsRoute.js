const express = require("express");
const { authUser } = require("../middlewares/authMidd");
const rcsController = require("../controllers/rcsController");
const rcsPlanController = require("../controllers/rcsPlanController");

const router = express.Router();

router.get("/rcs/provider", authUser, rcsController.getProvider);
router.post("/rcs/send", authUser, rcsController.sendImageTemplate);

router.get("/rcs/catalog", authUser, rcsPlanController.getCatalog);

router.post("/rcs/plans", authUser, rcsPlanController.createPlan);
router.get("/rcs/plans", authUser, rcsPlanController.getPlans);
router.put("/rcs/plans/:planId", authUser, rcsPlanController.updatePlan);
router.put("/rcs/plans/:planId/toggle", authUser, rcsPlanController.togglePlan);

router.get("/rcs/settings", authUser, rcsPlanController.getSettings);
router.put("/rcs/settings", authUser, rcsPlanController.updateSettings);

module.exports = router;
