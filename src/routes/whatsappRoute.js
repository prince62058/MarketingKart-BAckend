const express = require("express");
const router = express.Router();
const templateController = require("../controllers/whatsappTemplateController");
const campaignController = require("../controllers/whatsappCampaignController");
const webhookController = require("../controllers/webhookController");
const accountController = require("../controllers/whatsappAccountController");
const metaOAuthController = require("../controllers/metaOAuthController");
const { authUser } = require("../middlewares/authMidd");
const { uploadExcel, uploadWhatsAppMedia } = require("../middlewares/multer");

// ─── Webhook (no auth — Meta calls this directly) ──────────────────────────
router.get("/whatsapp/webhook", webhookController.getWhatsAppWebhook);
router.post("/whatsapp/webhook", webhookController.postWhatsAppWebhook);
router.get("/whatsapp/debug-logs", webhookController.getDebugLogs);

// ─── Stats & Account (mobile dashboard) ─────────────────────────────────────
router.get("/whatsapp/stats", authUser, campaignController.getWhatsAppStats);
router.post("/whatsapp/account/connect", authUser, accountController.connectAccount);
router.post("/whatsapp/account/connect-facebook", authUser, accountController.connectViaFacebook);
router.get("/whatsapp/account", authUser, accountController.getAccountDetails);
router.post("/whatsapp/account/disconnect", authUser, accountController.disconnectAccount);

// ─── Meta OAuth / Embedded Signup Flow ──────────────────────────────────────
router.get("/whatsapp/meta/start", authUser, metaOAuthController.startOAuth);
router.get("/whatsapp/meta/callback", metaOAuthController.handleCallback);
router.get("/whatsapp/meta/status", authUser, metaOAuthController.checkStatus);

// ─── Templates ──────────────────────────────────────────────────────────────
router.post("/whatsapp/templates/sync", authUser, templateController.syncTemplates);
router.post("/whatsapp/templates/ai-generate", authUser, templateController.aiGenerateTemplate);
router.post("/whatsapp/templates", authUser, templateController.createTemplate);
router.get("/whatsapp/templates", authUser, templateController.getAllTemplates);
router.get("/whatsapp/templates/:templateId", authUser, templateController.getTemplateById);
router.put("/whatsapp/templates/:templateId", authUser, templateController.updateTemplate);
router.post("/whatsapp/templates/upload-media", authUser, uploadWhatsAppMedia.single("media"), templateController.uploadMedia);

// ─── Campaigns ──────────────────────────────────────────────────────────────
// POST /whatsapp/send-campaign → alias used by mobile RTK Query
router.post(
  "/whatsapp/send-campaign",
  authUser,
  uploadExcel.single("contacts"),
  campaignController.createCampaign
);
router.post(
  "/whatsapp/campaigns",
  authUser,
  uploadExcel.single("contacts"),
  campaignController.createCampaign
);
router.get("/whatsapp/campaigns", authUser, campaignController.getAllCampaigns);
router.get("/whatsapp/campaigns/:campaignId", authUser, campaignController.getCampaignById);
router.put("/whatsapp/campaigns/:campaignId/pause", authUser, campaignController.pauseCampaign);
router.put("/whatsapp/campaigns/:campaignId/resume", authUser, campaignController.resumeCampaign);
router.delete("/whatsapp/campaigns/:campaignId", authUser, campaignController.deleteCampaign);

// ─── Report ─────────────────────────────────────────────────────────────────
router.get("/whatsapp/report", authUser, campaignController.getCampaignReport);

module.exports = router;
