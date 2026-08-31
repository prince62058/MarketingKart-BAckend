const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const controller = require("../controllers/pageLinkOAuthController");

// Browser-based Facebook Login for Business, for apps whose login is driven by
// a configuration id rather than a scope list.
router.post(
  "/facebook/page/oauth/start",
  asyncHandler(authUser),
  asyncHandler(controller.startPageLink),
);
// Facebook redirects the browser here — no auth header exists on that hop.
router.get("/facebook/page/oauth/callback", asyncHandler(controller.handlePageLinkCallback));
router.get(
  "/facebook/page/oauth/status",
  asyncHandler(authUser),
  asyncHandler(controller.pageLinkStatus),
);

module.exports = router;
