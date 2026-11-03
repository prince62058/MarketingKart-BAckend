const express = require("express");
const controller = require("../controllers/adBudgetController");
const { authUser, adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// The app reads the rules every time the customer opens "Create ad"; only the admin panel changes them.
router.get("/adBudget/settings", asyncHandler(authUser), asyncHandler(controller.getSettings));
router.put("/adBudget/settings", adminOnly, requirePermission("PLAN"), asyncHandler(controller.updateSettings));

module.exports = router;
