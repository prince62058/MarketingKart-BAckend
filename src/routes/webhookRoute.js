const express = require("express");
const controller = require("../controllers/webhookController");

const asyncHandler = require("../utils/asyncHandler");
const { authUser } = require("../middlewares/authMidd");
const { upload } = require("../middlewares/multer");
const router = express.Router();

router.post(
  "/webhook/getWebhook",
  // asyncHandler(authUser),
  asyncHandler(controller.postWebhook)
);
router.post(
  "/user/uploadLeadDocument",
  upload.single("document"),
  asyncHandler(controller.uploadLeadDocument)
);

router.get(
  "/webhook/getWebhook",
  // asyncHandler(authUser),
  asyncHandler(controller.getWebhook)
);

router.get(
  "/getLeadOfYourBussinessByMemberId",
  // asyncHandler(authUser),
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
  // asyncHandler(authUser),
  asyncHandler(controller.getLeadOfYourBusinessByMemberIdExcel)
);

router.get(
  "/getAllLeadsByPaginationForAdmin",
  asyncHandler(authUser),
  asyncHandler(controller.getAllLeadsByPaginationForAdmin)
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
  asyncHandler(controller.updateLeadSeenStatus)
)  

router.post('/bulkImportLeads',
  asyncHandler(authUser),
  asyncHandler(controller.bulkImportLeads)
)


module.exports = router;
