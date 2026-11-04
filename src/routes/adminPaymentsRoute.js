const express = require("express");
const controller = require("../controllers/adminPaymentsController");
const { adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Same permission as the Transaction page: whoever may see transactions may see what each was for.
router.get("/admin/payments", adminOnly, requirePermission("TRANSACTION"), asyncHandler(controller.list));

module.exports = router;
