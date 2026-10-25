const express = require("express");
const router = express.Router();
const businessController = require("../controllers/GstOfUserController");
const { authUser, adminOnly } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

// A GST record belongs to one user: its owner or an admin may use it (the controller checks which).
router.post("/createGstOfUser", asyncHandler(authUser), businessController.createGstOfUser);
router.get("/listOfGstOfUser", adminOnly, businessController.getGstOfUserModeles);
router.get("/getGstOfUseById", asyncHandler(authUser), businessController.getGstOfUserModelByGst);
router.get("/getGstOfUserByUserId", asyncHandler(authUser), businessController.getGstOfUserByUserId);
router.put("/updateGstOfUser", asyncHandler(authUser), businessController.updateGstOfUserModelByGst);

module.exports = router;
