const express = require("express");
const controller = require("../controllers/leadHistoryChangeStatusController");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.get(
  "/getAllLeadHistoryByLeadId",
  asyncHandler(authUser),
  asyncHandler(controller.getAllLeadHistoryByLeadId)
);
router.post(
  "/leadActionUpdate",
  asyncHandler(authUser),
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
  asyncHandler(controller.listOfLeadAssignUser)
);

module.exports = router;
