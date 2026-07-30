const express = require("express");
const controller = require("../controllers/offeringsController");
const router = express.Router();
const { offeringMid } = require("../middlewares/offeringsMidd");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const { upload } = require("../middlewares/multer");

router.post(
  "/offering/createOffering",
  asyncHandler(authUser),
  upload.single("image"),
  asyncHandler(controller.createOffering)
);
router.get(
  "/offering/getAllOffering",
  asyncHandler(authUser),
  asyncHandler(controller.getAllOffering)
);

router.get(
  "/offering/getSingleOffering/:offeringId",
  asyncHandler(authUser),
  asyncHandler(offeringMid),
  asyncHandler(controller.getSingleOffering)
);
router.put(
  "/offering/updateOffering/:offeringId",
  upload.single("image"),
  asyncHandler(authUser),
  asyncHandler(offeringMid),
  asyncHandler(controller.updateOffering)
);
router.put(
  "/offering/disableOffering/:offeringId",
  asyncHandler(authUser),
  asyncHandler(offeringMid),
  asyncHandler(controller.disableOffering)
);

module.exports = router;
