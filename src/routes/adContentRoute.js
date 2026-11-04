const express = require("express");
const controller = require("../controllers/adContentController");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Writes the campaign name, headline, primary text and caption for the Create Ad screen.
router.post("/adContent/generate", asyncHandler(authUser), asyncHandler(controller.generate));

module.exports = router;
