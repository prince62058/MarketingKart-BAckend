const express = require("express");
const { authUser } = require("../middlewares/authMidd");
const rcsController = require("../controllers/rcsController");

const router = express.Router();

router.get("/rcs/provider", authUser, rcsController.getProvider);
router.post("/rcs/send", authUser, rcsController.sendImageTemplate);

module.exports = router;
