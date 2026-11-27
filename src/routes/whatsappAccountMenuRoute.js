const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const { staffPermission } = require("../middlewares/adminPermission");
const ctrl = require("../controllers/whatsappAccountMenuController");

router.get("/whatsapp/account-menu", authUser, ctrl.getAccountMenu);
router.put("/whatsapp/account-menu", authUser, staffPermission("WA_PLANS"), ctrl.saveAccountMenu);

module.exports = router;
