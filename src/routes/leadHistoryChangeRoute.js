const express = require("express");
const controller = require("../controllers/leadHistoryChangeStatusController");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const { requireLeadAccess } = require("../middlewares/businessAccessMidd");
const asyncHandler = require("../utils/asyncHandler");

router.get(
  "/getAllLeadHistoryByLeadId",
  asyncHandler(authUser),
  requireLeadAccess("query", "leadId"),
  asyncHandler(controller.getAllLeadHistoryByLeadId)
);
router.post(
  "/leadActionUpdate",
  asyncHandler(authUser),
  requireLeadAccess("query", "leadId"),
  asyncHandler(controller.updateLeadHistory)
);
router.post(
  "/createLeadHistoryWithTransferAndRevolked",
  asyncHandler(authUser),
  asyncHandler(controller.createLeadHistoryWithTransferAndRevolked)
);
router.get(
  "/listOfLeadAssignUser",
  asyncHandler(authUser),
  requireLeadAccess("query", "leadId"),
  asyncHandler(controller.listOfLeadAssignUser)
);

module.exports = router;
