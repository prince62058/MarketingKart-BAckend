const {
  createCall,
  listCallRequest,
  updateCallRequestStatus,
  assignCallRequest,
  deleteFollowUp,
  deleteCallRequest,
  pushFollowUp,
  autoAssignAll
} = require("../controllers/callRequestController");
const express = require("express");
const { userMid } = require("../middlewares/userMidd");
const { authUser, adminOnly } = require("../middlewares/authMidd");
const router = express.Router();

const asyncHandler = require("../utils/asyncHandler");

router.post("/createCall/:userId", asyncHandler(authUser), asyncHandler(userMid), createCall);
router.get("/listCallRequest", adminOnly, listCallRequest);
router.put("/updateCallRequestStatus", asyncHandler(authUser), updateCallRequestStatus);
router.put("/pushFollowUp", asyncHandler(authUser), pushFollowUp);
router.put("/assignCallRequest", asyncHandler(authUser), assignCallRequest);
router.delete("/deleteFollowUp", asyncHandler(authUser), deleteFollowUp);
router.delete("/deleteCallRequest", asyncHandler(authUser), deleteCallRequest);
router.put("/autoAssignAllCallRequests", asyncHandler(authUser), autoAssignAll);

module.exports = router;
