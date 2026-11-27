const express = require("express");
const controller = require("../controllers/aiImagePlanController");
const router = express.Router();
const { authUser, adminOnly } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
  "/aiImagePlan/createAiImagePlan",
  ...adminOnly,
  asyncHandler(controller.createAiImage)
);

router.get(
  "/aiImagePlan/getAllAiImagePlan",
  asyncHandler(authUser),
  asyncHandler(controller.getAllAiImagePlan)
);

module.exports = router;