const express = require("express");
const controller = require("../controllers/userRoleControler");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
    '/createRole',
    asyncHandler(controller.createRole)
)

router.get(
    '/getRoleByItsId',
    asyncHandler(controller.getRoleByItsId)
)

router.get(
    '/filterUserRole',
    asyncHandler(controller.filterUserRole)
)

router.put(
    '/updateRole',
    asyncHandler(controller.updateRole)
)

router.delete(
    '/deleteRoleById',
    asyncHandler(controller.deleteRoleById)
)

module.exports = router;