const controller = require("../controllers/phonePayController");
const express = require("express");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const router = express.Router();

router.post("/PhonePayGateway", asyncHandler(authUser), controller.PhonePayGateway);
router.post("/PhonePayGatewayStatus", asyncHandler(authUser), controller.PhonePayGatewayStatus);
router.get("/PhonePayGatewayCheckStatus", asyncHandler(authUser), controller.PhonePayGatewayCheckStatus);


module.exports = router;
