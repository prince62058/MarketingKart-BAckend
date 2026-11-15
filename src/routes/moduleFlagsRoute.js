const express = require("express");
const { authUser, adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");
const ctrl = require("../controllers/moduleFlagsController");

const router = express.Router();
const manageCompany = [adminOnly, requirePermission("COMPANY")];

// App + admin both read; only COMPANY admins write.
router.get("/module-flags", authUser, ctrl.getFlags);
router.put("/module-flags", manageCompany, ctrl.updateFlags);
router.put("/module-flags/:module/toggle", manageCompany, ctrl.toggleModule);

module.exports = router;
