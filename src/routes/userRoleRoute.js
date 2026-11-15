const express = require("express");
const controller = require("../controllers/userRoleControler");
const router = express.Router();
const { adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const asyncHandler = require("../utils/asyncHandler");

// Roles and permissions decide what staff can do: reading is for admins, changing needs the STAFF permission.
const manageRoles = [adminOnly, requirePermission("STAFF")];

router.post(
    '/createRole',
    manageRoles,
    asyncHandler(controller.createRole)
)

router.get(
    '/getRoleByItsId',
    adminOnly,
    asyncHandler(controller.getRoleByItsId)
)

router.get(
    '/filterUserRole',
    adminOnly,
    asyncHandler(controller.filterUserRole)
)

router.put(
    '/updateRole',
    manageRoles,
    asyncHandler(controller.updateRole)
)

router.delete(
    '/deleteRoleById',
    manageRoles,
    asyncHandler(controller.deleteRoleById)
)

module.exports = router;