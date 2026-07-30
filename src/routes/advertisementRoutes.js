const express = require("express");
const {
  createAdvertisement,
  disableAdvertisement,
  getAllAdvertisements,
  getSingleAdvertisement,
  updateAdvertisement,
  getEstimates,
} = require("../controllers/advertisementController");
const { authUser } = require("../middlewares/authMidd");
const { advertisementMid } = require("../middlewares/advertisementMidd");
const { upload } = require("../middlewares/multer");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get(
  "/advertisement/getSingleAdvertisment/:advertisementId",
  asyncHandler(authUser),
  asyncHandler(advertisementMid),
  asyncHandler(getSingleAdvertisement)
);
router.get(
  "/advertisement/getAllAdvertisment",

  asyncHandler(getAllAdvertisements)
);
router.post(
  "/advertisement/createAdvertisment",
  asyncHandler(authUser),
  upload.single("image"),
  asyncHandler(createAdvertisement)
);
router.put(
  "/advertisement/updateAdvertisment/:advertisementId",
  asyncHandler(authUser),
  asyncHandler(advertisementMid),
  upload.single("image"),
  asyncHandler(updateAdvertisement)
);
router.put(
  "/advertisement/disableAdvertisment/:advertisementId",
  asyncHandler(authUser),
  asyncHandler(advertisementMid),
  asyncHandler(disableAdvertisement)
);
router.get(
  "/advertisement/getEstimates/:advertisementId",
  asyncHandler(authUser),
  asyncHandler(advertisementMid),
  asyncHandler(getEstimates)
);

router.delete(
  "/advertisement/deleteAdvertisment/:advertisementId",
  asyncHandler(authUser),
  asyncHandler(advertisementMid),
  asyncHandler(require("../controllers/advertisementController").deleteAdvertisement)
);

module.exports = router;
