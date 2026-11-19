const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const { getReelContent, saveReelContent } = require("../controllers/reelContentController");

const router = express.Router();

router.get("/reel-content", asyncHandler(getReelContent));
router.put("/reel-content", ...adminOnly, requirePermission("REELS"), asyncHandler(saveReelContent));

module.exports = router;
