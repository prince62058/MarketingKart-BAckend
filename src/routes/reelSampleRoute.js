const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const { uploadReelMedia } = require("../middlewares/multer");
const { listReelSamples, saveReelSample } = require("../controllers/reelSampleController");

const router = express.Router();

router.get("/reel-samples", asyncHandler(listReelSamples));
router.put(
  "/reel-samples/:kind/:slot",
  ...adminOnly,
  requirePermission("REELS"),
  uploadReelMedia.fields([{ name: "video", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]),
  asyncHandler(saveReelSample)
);

module.exports = router;
