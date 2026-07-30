const express = require("express");
const controller = require("../controllers/faqController");
const router = express.Router();
const { faqMid } = require("../middlewares/faqMidd");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");

router.post(
  "/faq/createFaq",
  asyncHandler(authUser),
  asyncHandler(controller.createFaq)
);
router.get(
  "/faq/getAllfaq",
  asyncHandler(authUser),
  asyncHandler(controller.getAllFaqs)
);
router.get(
  "/faq/getDetailsFaq/:faqId",
  asyncHandler(authUser),
  asyncHandler(faqMid),
  asyncHandler(controller.getDetailsFaq)
);
router.put(
  "/faq/disableFaq/:faqId",
  asyncHandler(authUser),
  asyncHandler(faqMid),
  asyncHandler(controller.disableFaqs)
);
router.put(
  "/faq/updatefaq/:faqId",
  asyncHandler(authUser),
  asyncHandler(faqMid),
  asyncHandler(controller.updateFaqs)
);
module.exports = router;
