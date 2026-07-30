const express = require("express");
const router = express.Router();
const businessController = require("../controllers/GstOfUserController");

router.post("/createGstOfUser", businessController.createGstOfUser);
router.get("/listOfGstOfUser", businessController.getGstOfUserModeles);
router.get("/getGstOfUseById", businessController.getGstOfUserModelByGst);
router.get("/getGstOfUserByUserId", businessController.getGstOfUserByUserId);
router.put("/updateGstOfUser", businessController.updateGstOfUserModelByGst);

module.exports = router;
