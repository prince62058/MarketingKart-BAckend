const express = require('express')
const controller = require('../controllers/adsDetailsController')
const router = express.Router()
const asyncHandler = require("../utils/asyncHandler");
const { authUser } = require("../middlewares/authMidd");

router.get(
    "/internalCampiagn/getAllInternalCampiagnByBusinessId",
    asyncHandler(authUser),
    asyncHandler(controller.getAllAdsList)
  );
module.exports = router