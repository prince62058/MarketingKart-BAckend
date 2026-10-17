const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const {
  createSubscription,
  getMySubscription,
  getPlanPrices,
  checkPlanPrice,
} = require("../controllers/subscriptionController");

router.post("/subscriptions", asyncHandler(authUser), createSubscription);
router.get("/subscriptions/me", asyncHandler(authUser), getMySubscription);
router.get("/subscriptions/plan-prices", asyncHandler(authUser), getPlanPrices);
router.post("/subscriptions/plan-prices/check", asyncHandler(authUser), checkPlanPrice);

module.exports = router;
