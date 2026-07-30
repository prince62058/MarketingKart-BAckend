const express = require("express");
const controller = require("../controllers/ImageBusinessController");
const router = express.Router();
const { upload } = require("../middlewares/multer");
const { imageBusinessMid } = require("../middlewares/ImageBusinessMidd");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
  "/imageBusiness/createImageBusiness",
  asyncHandler(authUser),
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
  asyncHandler(authUser),
  asyncHandler(imageBusinessMid),
  asyncHandler(controller.disableImageBusiness)
);
router.put(
  "/imageBusiness/updateimageBusiness/:imageBusinessId",
  asyncHandler(authUser),
  asyncHandler(imageBusinessMid),
  upload.single("image"),
  asyncHandler(controller.updateImageBusiness)
);
module.exports = router;
