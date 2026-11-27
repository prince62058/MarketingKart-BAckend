const express = require('express')
const controller = require('../controllers/adsDetailsController')
const router = express.Router()
const asyncHandler = require("../utils/asyncHandler");
const { authUser } = require("../middlewares/authMidd");
const { requireBusinessAccess } = require("../middlewares/businessAccessMidd");

router.get(
    "/internalCampiagn/getAllInternalCampiagnByBusinessId",
    asyncHandler(authUser),
    requireBusinessAccess("query", "businessId"),
    asyncHandler(controller.getAllAdsList)
  );
module.exports = router