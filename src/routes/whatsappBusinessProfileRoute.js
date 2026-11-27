// Business profile, commerce and calling settings for the user's connected WhatsApp number.
const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const svc = require("../services/whatsappBusinessProfileService");

const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    if (error instanceof svc.ProfileError) return res.status(error.status).json({ success: false, message: error.message });
    console.error("[whatsapp business profile]", error.message);
    res.status(500).json({ success: false, message: "Something went wrong. Try again." });
  }
};

router.get("/whatsapp/business-profile", authUser, handle((req) => svc.getProfile(req.user._id)));
router.put("/whatsapp/business-profile", authUser, handle((req) => svc.updateProfile(req.user._id, req.body || {})));
router.get("/whatsapp/business-profile/commerce", authUser, handle((req) => svc.getCommerce(req.user._id)));
router.put("/whatsapp/business-profile/commerce", authUser, handle((req) => svc.updateCommerce(req.user._id, req.body || {})));
router.get("/whatsapp/business-profile/calling", authUser, handle((req) => svc.getCalling(req.user._id)));
router.put("/whatsapp/business-profile/calling", authUser, handle((req) => svc.updateCalling(req.user._id, req.body || {})));

module.exports = router;
