const express = require("express");
const controller = require("../controllers/webhookController");

const asyncHandler = require("../utils/asyncHandler");
const { authUser } = require("../middlewares/authMidd");
const { requireBusinessAccess, requireLeadAccess } = require("../middlewares/businessAccessMidd");
const { upload } = require("../middlewares/multer");
const router = express.Router();

router.post(
  "/webhook/getWebhook",
  // asyncHandler(authUser),
  asyncHandler(controller.postWebhook)
);
router.post(
  "/user/uploadLeadDocument",
  asyncHandler(authUser),
  upload.single("document"),
  requireLeadAccess("body", "leadId"),
  asyncHandler(controller.uploadLeadDocument)
);

router.get(
  "/webhook/getWebhook",
  // asyncHandler(authUser),
  asyncHandler(controller.getWebhook)
);

router.get(
  "/getLeadOfYourBussinessByMemberId",
  asyncHandler(authUser),
  requireBusinessAccess("query", "businessId"),
  asyncHandler(controller.getLeadOfYourBussinessByMemberId)
);

router.get(
  "/getSingleLeadDetail",
  asyncHandler(authUser),
  asyncHandler(controller.getSingleLeadDetail)
);
router.get(
  "/getAllLeadsByPagination",
  asyncHandler(authUser),
  asyncHandler(controller.getAllLeadsByPagination)
);

router.get(
  "/getLeadOfYourBusinessByMemberIdExcel",
  asyncHandler(authUser),
  requireBusinessAccess("query", "businessId"),
  asyncHandler(controller.getLeadOfYourBusinessByMemberIdExcel)
);

router.get(
  "/getAllLeadsByPaginationForAdmin",
  asyncHandler(authUser),
  asyncHandler(controller.getAllLeadsByPaginationForAdmin)
);

// Pull-to-refresh on the Leads tab: ask Meta for this business's Instant Form
// leads right now instead of waiting for the hourly catch-up.
router.get(
  "/leads/syncNow",
  asyncHandler(authUser),
  asyncHandler(controller.syncLeadsNow)
);
router.get(
  "/getLeadDetails",
  asyncHandler(authUser),
  asyncHandler(controller.getLeadDetails)
);

router.put('/updateLeadDetails',
asyncHandler(authUser),
asyncHandler(controller.updateLeadDetails)
)

router.put('/updateLeadSeenStatus',
  asyncHandler(authUser),
  requireLeadAccess("query", "leadId"),
  asyncHandler(controller.updateLeadSeenStatus)
)  

router.post('/bulkImportLeads',
  asyncHandler(authUser),
  asyncHandler(controller.bulkImportLeads)
)


module.exports = router;
