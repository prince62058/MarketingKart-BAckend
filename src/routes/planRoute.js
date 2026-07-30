const express = require("express");
const controller = require("../controllers/planController");
const router = express.Router();
const { planMid } = require("../middlewares/planMidd");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
router.get(
  "/plan/getAdvertisementTypeIdByPlan",
  asyncHandler(controller.getAdvertisementTypeIdByPlan)
);
router.post(
  "/plan/createPlan",
  asyncHandler(authUser),
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
  asyncHandler(authUser),
  asyncHandler(planMid),
  asyncHandler(controller.updatePlan)
);
router.put(
  "/plan/disablePlan/:planId",
  asyncHandler(authUser),
  asyncHandler(planMid),
  asyncHandler(controller.disablePlan)
);

module.exports = router;
