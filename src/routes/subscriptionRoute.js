const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const {
  createSubscription,
  getMySubscription,
} = require("../controllers/subscriptionController");

router.post("/subscriptions", asyncHandler(authUser), createSubscription);
router.get("/subscriptions/me", asyncHandler(authUser), getMySubscription);

module.exports = router;
