const express = require("express");
const controller = require("../controllers/permissionController");
const router = express.Router();
const { userMid } = require("../middlewares/userMidd");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
    '/createuserRole',
    asyncHandler(authUser),
    asyncHandler(controller.createUserRole)
)

router.get(
    '/getAllUserRole',
    asyncHandler(authUser),
    asyncHandler(controller.getAllRole)
)

router.get(
    '/getRoleById',
    asyncHandler(authUser),
    asyncHandler(controller.getRoleById)
)

router.put(
    '/updateUserRole',
    asyncHandler(authUser),
    asyncHandler(controller.updateUserRole)
)

router.put(
    '/assignPermssionsToUser',
    asyncHandler(authUser),
    asyncHandler(controller.assignPermssionsToUser)
)

module.exports = router;