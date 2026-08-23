const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const {
  addTeamMember,
  getTeamMembers,
  updateTeamMember,
  removeTeamMember,
} = require("../controllers/teamMemberController");

router.post("/team-members", asyncHandler(authUser), addTeamMember);
router.get("/team-members", asyncHandler(authUser), getTeamMembers);
router.put("/team-members/:memberId", asyncHandler(authUser), updateTeamMember);
router.delete("/team-members/:memberId", asyncHandler(authUser), removeTeamMember);

module.exports = router;
