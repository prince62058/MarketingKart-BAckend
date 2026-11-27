const express = require("express");
const controller = require("../controllers/ImageBusinessController");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { imageBusinessMid } = require("../middlewares/ImageBusinessMidd");
const { authUser, adminOnly } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
  "/imageBusiness/createImageBusiness",
  ...adminOnly,
  upload.single("image"),
  asyncHandler(controller.createImageBusiness)
);
router.get(
  "/imageBusiness/getAllImageBusiness",
  asyncHandler(authUser),
  asyncHandler(controller.getAllImageBusiness)
);
router.get(
    "/imageBusiness/getDetailsImageBusiness/:imageBusinessId",
    asyncHandler(authUser),
    asyncHandler(imageBusinessMid),
    asyncHandler(controller.getDetailsImageBusiness)
  );
router.put(
  "/imageBusiness/disableImageBusiness/:imageBusinessId",
  ...adminOnly,
  asyncHandler(imageBusinessMid),
  asyncHandler(controller.disableImageBusiness)
);
router.put(
  "/imageBusiness/updateimageBusiness/:imageBusinessId",
  ...adminOnly,
  asyncHandler(imageBusinessMid),
  upload.single("image"),
  asyncHandler(controller.updateImageBusiness)
);
module.exports = router;
