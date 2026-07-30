const express = require("express");
const controller = require("../controllers/rolePermissionController");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");

router.post(
    '/createRoleAndPermission',
    asyncHandler(controller.createRoleAndPermission)
)

router.get(
    '/getRolePermissionById',
    asyncHandler(controller.getRolePermissionById)
)

router.get(
    '/filterRolePermission',
    asyncHandler(controller.filterRolePermission)
)

router.put(
    '/updateRolePermission',
    asyncHandler(controller.updateRolePermission)
)

router.delete(
    '/deleteRolePermissionById',
    asyncHandler(controller.deleteRolePermissionById)
)

module.exports = router;