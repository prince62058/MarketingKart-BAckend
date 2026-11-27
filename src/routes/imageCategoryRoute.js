const express = require("express");
const controller = require("../controllers/imageCategoryController");
const router = express.Router();
const { imageCategoryMid } = require("../middlewares/imageCategoryMidd");
const { authUser, adminOnly } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
  "/imageCategory/createImageCategory",
  ...adminOnly,
  asyncHandler(controller.createImageCategory)
);
router.get(
  "/imageCategory/getAllimageCategory",
  asyncHandler(authUser),
  asyncHandler(controller.getAllImageCategory)
);
router.get(
  "/imageCategory/getDetailsImageCategory/:imageCategoryId",
  asyncHandler(authUser),
  asyncHandler(imageCategoryMid),
  asyncHandler(controller.getDetailsImageCategory)
);
router.put(
  "/imageCategory/disableimageCategory/:imageCategoryId",
  ...adminOnly,
  asyncHandler(imageCategoryMid),
  asyncHandler(controller.disableImageCategory)
);
router.put(
  "/imageCategory/updateimageCategory/:imageCategoryId",
  ...adminOnly,
  asyncHandler(imageCategoryMid),
  asyncHandler(controller.updateImageCategory)
);
module.exports = router;
