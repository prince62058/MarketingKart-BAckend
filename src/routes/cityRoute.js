const express = require("express");
const controller = require("../controllers/cityController");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { cityMid } = require("../middlewares/cityMidd");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
  "/city/createCity",
  asyncHandler(authUser),
  upload.single("icon"),
  asyncHandler(controller.createCity)
);
router.get(
  "/city/getAllCity",
  asyncHandler(authUser),
  asyncHandler(controller.getAllCities)
);
router.get(
  "/callback",
  asyncHandler(controller.callback)
);
router.put(
  "/city/updateCity/:cityId",
  asyncHandler(authUser),
  asyncHandler(cityMid),
  upload.single("icon"),
  asyncHandler(controller.updateCity)
);
router.put(
  "/city/disable/:cityId",
  asyncHandler(authUser),
  asyncHandler(cityMid),
  asyncHandler(controller.delete)
);

module.exports = router;
