const controller = require("../controllers/phonePayController");
const express = require("express");
const router = express.Router();

router.post("/PhonePayGateway", controller.PhonePayGateway);
router.post("/PhonePayGatewayStatus", controller.PhonePayGatewayStatus);
router.get("/PhonePayGatewayCheckStatus", controller.PhonePayGatewayCheckStatus);


module.exports = router;
