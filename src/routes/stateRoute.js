const express = require("express");
const controller = require("../controllers/stateController");
const { upload } = require("../middlewares/multer");
const { countryMid } = require("../middlewares/countryMidd");
const { stateMid } = require("../middlewares/stateMidd");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

router.post(
  "/state/createState/:countryId",
  asyncHandler(authUser),
  asyncHandler(countryMid),
  upload.single("icon"),
  asyncHandler(controller.createState)
);
router.get(
  "/state/getAllState",
  asyncHandler(authUser),
  asyncHandler(controller.getAllState)
);
router.put(
  "/state/updateState/:stateId",
  asyncHandler(authUser),
  asyncHandler(stateMid),
  upload.single("icon"),
  asyncHandler(controller.updateState)
);
router.put(
  "/state/disable/:stateId",
  asyncHandler(authUser),
  asyncHandler(stateMid),
  asyncHandler(controller.delete)
);

module.exports = router;
