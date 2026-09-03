const express = require("express");
const {
  createGoogleAdsInquiry,
  getAllGoogleAdsInquiries,
  updateGoogleAdsInquiryStatus,
  deleteGoogleAdsInquiry,
} = require("../controllers/googleAdsInquiryController");

const router = express.Router();

// Public / User inquiry submission
router.post("/googleAdsInquiry", createGoogleAdsInquiry);
router.post("/createGoogleAdsInquiry", createGoogleAdsInquiry);

// Admin listing and management
router.get("/getAllGoogleAdsInquiry", getAllGoogleAdsInquiries);
router.get("/googleAdsInquiries", getAllGoogleAdsInquiries);
router.put("/updateGoogleAdsInquiry/:id", updateGoogleAdsInquiryStatus);
router.delete("/deleteGoogleAdsInquiry/:id", deleteGoogleAdsInquiry);

module.exports = router;
