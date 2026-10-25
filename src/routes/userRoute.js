const express = require("express");
const controller = require("../controllers/userController");
const { userMid } = require("../middlewares/userMidd");
const { upload } = require("../middlewares/multer");
const { authUser, isAdmin, adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

router.post("/user/mobileLogIn", asyncHandler(controller.mobileLogIn));

router.post("/user/verifyOtp", asyncHandler(controller.verifyOtp));

router.put(
  "/user/updateProfile/:userId",
  asyncHandler(authUser),
  asyncHandler(userMid),
  upload.single("image"),
  asyncHandler(controller.updateProfile)
);
router.get(
  "/user/getAllUsersWithBusiness",
  adminOnly,
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
  adminOnly,
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
  adminOnly,
  asyncHandler(controller.getAllUser)
);

router.put(
  "/user/disableUser/:userId",
  adminOnly,
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
  adminOnly,
  asyncHandler(controller.getAllSubUser)
);


// ADMIN
router.post("/user/adminLogIn", asyncHandler(controller.adminLogIn));
router.post("/user/verifyAdminEmailOtp", asyncHandler(controller.verifyAdminEmailOtp));
// Minting an admin account is a staff-management action: a limited staff member must not be able to do it.
router.post("/user/CreateAdminSubAdmin", adminOnly, requirePermission("STAFF"), asyncHandler(controller.CreateAdminSubAdmin));


//  v2
router.post("/user/sendOtpForMobile", asyncHandler(controller.sendOtpForMobileV2));
router.post("/user/verifyMobileOtp", asyncHandler(controller.verifyMobileOtpV2));
router.put(
  "/user/CreateSubUser",
  adminOnly,
  upload.single("image"),
  asyncHandler(controller.CreateSubUserV2)
);
router.post("/user/V2/mobileLogInV2", asyncHandler(controller.mobileLogInV2));
router.post("/user/V2/verifyMobileOtpV2", asyncHandler(controller.verifyOtpV2));

router.post("/user/updateFcm", asyncHandler(authUser), asyncHandler(controller.updateFcm));

module.exports = router;

