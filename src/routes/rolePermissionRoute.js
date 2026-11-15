const express = require("express");
const controller = require("../controllers/rolePermissionController");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");
const { adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");

// Roles and permissions decide what staff can do: reading is for admins, changing needs the STAFF permission.
const manageRoles = [adminOnly, requirePermission("STAFF")];

router.post(
    '/createRoleAndPermission',
    manageRoles,
    asyncHandler(controller.createRoleAndPermission)
)

router.get(
    '/getRolePermissionById',
    adminOnly,
    asyncHandler(controller.getRolePermissionById)
)

router.get(
    '/filterRolePermission',
    adminOnly,
    asyncHandler(controller.filterRolePermission)
)

router.put(
    '/updateRolePermission',
    manageRoles,
    asyncHandler(controller.updateRolePermission)
)

router.delete(
    '/deleteRolePermissionById',
    manageRoles,
    asyncHandler(controller.deleteRolePermissionById)
)

module.exports = router;