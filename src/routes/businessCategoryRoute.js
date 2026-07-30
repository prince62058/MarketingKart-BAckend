const express = require("express");
const controller = require("../controllers/businessCategoryController");
const router = express.Router();
const { categoryMid } = require("../middlewares/businessCategoryMid");
const { upload } = require("../middlewares/multer");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
  "/category/createCategory",
  asyncHandler(authUser),
  upload.single("icon"),
  asyncHandler(controller.createCategory)
);
router.get(
  "/category/getAllCategory",
  asyncHandler(authUser),
  asyncHandler(controller.getAllCategory)
);


router.get(
  "/category/getAllPCategory",
  asyncHandler(authUser),
  asyncHandler(controller.getAllPCategory)
);

router.get(
  "/category/getCategoryById/:categoryId",
  asyncHandler(authUser),
  asyncHandler(categoryMid),
  asyncHandler(controller.getCategoryById)
);
router.put(
  "/category/updateCategory/:categoryId",
  asyncHandler(authUser),
  asyncHandler(categoryMid),
  upload.single("icon"),
  asyncHandler(controller.updateCategory)
);
router.put(
  "/category/disbaleCategory/:categoryId",
  asyncHandler(authUser),
  asyncHandler(categoryMid),
  asyncHandler(controller.disableCategory)
);

module.exports = router;
