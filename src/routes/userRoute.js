const express = require("express");
const controller = require("../controllers/userController");
const { userMid } = require("../middlewares/userMidd");
const { upload } = require("../middlewares/multer");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

router.post("/user/mobileLogIn", asyncHandler(controller.mobileLogIn));

router.post("/user/verifyOtp", asyncHandler(controller.verifyOtp));

router.put(
  "/user/updateProfile/:userId",
  asyncHandler(userMid),
  upload.single("image"),
  asyncHandler(controller.updateProfile)
);
router.get(
  "/user/getAllUsersWithBusiness",
  asyncHandler(controller.getAllUsersWithBusiness)
);
router.get(
  "/user/getByIdUser/:userId",
  asyncHandler(authUser),
  asyncHandler(userMid),
  asyncHandler(controller.getByIdUser)
);
router.get(
  "/user/getByIdUserForAdmin/:userId",
  asyncHandler(authUser),
  asyncHandler(userMid),
  asyncHandler(controller.getByIdUserForAdmin)
);
router.get(
  '/user/getAllSubUserByBusinessId',
  asyncHandler(authUser),
  asyncHandler(controller.getAllSubUserByBusinessId)
)

router.get(
  "/user/getAllUser",
  asyncHandler(authUser),
  asyncHandler(controller.getAllUser)
);

router.put(
  "/user/disableUser/:userId",
  asyncHandler(authUser),
  asyncHandler(userMid),
  asyncHandler(controller.disableUser)
);


router.post("/user/verifyEmailOtp", asyncHandler(controller.verifyEmailOtp));
router.post("/user/LogIn", asyncHandler(controller.LogIn));
router.post("/user/sendOtpForEmail", asyncHandler(controller.sendOtpForEmail));

router.get(
  "/permissionListApi",
  asyncHandler(authUser),
  asyncHandler(controller.permissionListApi)
);

router.get(
  "/permissionListApiForBusiness",
  asyncHandler(authUser),
  asyncHandler(controller.permissionListApiForBusiness)
);

router.get(
  "/user/getAllSubUser",
  asyncHandler(controller.getAllSubUser)
);


// ADMIN
router.post("/user/adminLogIn", asyncHandler(controller.adminLogIn));
router.post("/user/verifyAdminEmailOtp", asyncHandler(controller.verifyAdminEmailOtp));
router.post("/user/CreateAdminSubAdmin", asyncHandler(controller.CreateAdminSubAdmin));


//  v2
router.post("/user/sendOtpForMobile", asyncHandler(controller.sendOtpForMobileV2));
router.post("/user/verifyMobileOtp", asyncHandler(controller.verifyMobileOtpV2));
router.put(
  "/user/CreateSubUser",
  upload.single("image"),
  asyncHandler(controller.CreateSubUserV2)
);
router.post("/user/V2/mobileLogInV2", asyncHandler(controller.mobileLogInV2));
router.post("/user/V2/verifyMobileOtpV2", asyncHandler(controller.verifyOtpV2));


module.exports = router;
