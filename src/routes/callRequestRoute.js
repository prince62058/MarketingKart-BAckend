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
router.put("/updateCallRequestStatus", adminOnly, updateCallRequestStatus);
router.put("/pushFollowUp", adminOnly, pushFollowUp);
router.put("/assignCallRequest", adminOnly, assignCallRequest);
router.delete("/deleteFollowUp", adminOnly, deleteFollowUp);
router.delete("/deleteCallRequest", adminOnly, deleteCallRequest);
router.put("/autoAssignAllCallRequests", adminOnly, autoAssignAll);

module.exports = router;
