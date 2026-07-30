const express = require("express");
const controller = require("../controllers/countryController");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { countryMid } = require("../middlewares/countryMidd");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
  "/country/createCountry",
  asyncHandler(authUser),
  upload.single("icon"),
  asyncHandler(controller.createCountry)
);
router.get(
  "/country/getAllCountry",
  asyncHandler(authUser),
  asyncHandler(controller.getAllCountry)
);
router.put(
  "/country/disableCountry/:countryId",
  asyncHandler(authUser),
  asyncHandler(countryMid),
  asyncHandler(controller.disableCountry)
);
router.put(
  "/country/updateCountry/:countryId",
  asyncHandler(authUser),
  asyncHandler(countryMid),
  upload.single("icon"),
  asyncHandler(controller.updateCountry)
);
module.exports = router;
