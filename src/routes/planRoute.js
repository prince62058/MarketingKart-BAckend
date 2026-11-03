const express = require("express");
const controller = require("../controllers/planController");
const router = express.Router();
const { planMid } = require("../middlewares/planMidd");
const { authUser, adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const asyncHandler = require("../utils/asyncHandler");
router.get(
  "/plan/getAdvertisementTypeIdByPlan",
  asyncHandler(controller.getAdvertisementTypeIdByPlan)
);
// Packages are what customers are charged for, so only the admin panel may create, change or remove them.
const managePlans = [adminOnly, requirePermission("PLAN")];
router.post(
  "/plan/createPlan",
  managePlans,
  asyncHandler(controller.createPlan)
);
router.get(
  "/plan/getAllPlan",
  asyncHandler(authUser),
  asyncHandler(controller.getAllPlan)
);

router.get(
  "/plan/getSinglePlan/:planId",
  asyncHandler(authUser),
  asyncHandler(planMid),
  asyncHandler(controller.getSinglePlan)
);
router.put(
  "/plan/updatePlan/:planId",
  managePlans,
  asyncHandler(planMid),
  asyncHandler(controller.updatePlan)
);
router.put(
  "/plan/disablePlan/:planId",
  managePlans,
  asyncHandler(planMid),
  asyncHandler(controller.disablePlan)
);
router.delete(
  "/plan/deletePlan/:planId",
  managePlans,
  asyncHandler(planMid),
  asyncHandler(controller.deletePlan)
);

module.exports = router;
