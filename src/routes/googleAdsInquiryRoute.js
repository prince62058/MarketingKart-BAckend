const express = require("express");
const {
  createGoogleAdsInquiry,
  getAllGoogleAdsInquiries,
  updateGoogleAdsInquiryStatus,
  deleteGoogleAdsInquiry,
} = require("../controllers/googleAdsInquiryController");

const { adminOnly } = require("../middlewares/authMidd");

const router = express.Router();

// Public / User inquiry submission
router.post("/googleAdsInquiry", require("../middlewares/rateLimit").limits.publicForm, require("../middlewares/authMidd").optionalAuth, createGoogleAdsInquiry);
router.post("/createGoogleAdsInquiry", require("../middlewares/rateLimit").limits.publicForm, require("../middlewares/authMidd").optionalAuth, createGoogleAdsInquiry);

// Admin listing and management
router.get("/getAllGoogleAdsInquiry", adminOnly, getAllGoogleAdsInquiries);
router.get("/googleAdsInquiries", adminOnly, getAllGoogleAdsInquiries);
router.put("/updateGoogleAdsInquiry/:id", adminOnly, updateGoogleAdsInquiryStatus);
router.delete("/deleteGoogleAdsInquiry/:id", adminOnly, deleteGoogleAdsInquiry);

module.exports = router;
