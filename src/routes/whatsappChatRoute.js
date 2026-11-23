const express = require("express");
const router = express.Router();
const whatsappChatController = require("../controllers/whatsappChatController");
const whatsappBotController = require("../controllers/whatsappBotController");
const whatsappConversionController = require("../controllers/whatsappConversionController");
const { authUser: auth } = require("../middlewares/authMidd");

const { uploadWhatsAppMedia } = require("../middlewares/multer");
const templateController = require("../controllers/whatsappTemplateController");

router.get("/sync-status", auth, whatsappChatController.getSyncStatus);
router.get("/bot-config", auth, whatsappBotController.getBotConfig);
router.put("/bot-config", auth, whatsappBotController.updateBotConfig);
router.get("/bot-plans", auth, whatsappBotController.getChatbotPlans);
router.post("/bot-plans", auth, whatsappBotController.createChatbotPlan);
router.put("/bot-plans/:planId", auth, whatsappBotController.updateChatbotPlan);
router.put("/bot-plans/:planId/toggle", auth, whatsappBotController.toggleChatbotPlan);
router.get("/bot-settings", auth, whatsappBotController.getChatbotSettings);
router.put("/bot-settings", auth, whatsappBotController.updateChatbotSettings);
router.get("/bot-subscription", auth, whatsappBotController.getChatbotSubscription);
router.post("/bot-plans/purchase", auth, whatsappBotController.purchaseChatbotPlan);
router.get("/media/:messageId", auth, whatsappChatController.getMedia);
router.get("/conversations", auth, whatsappChatController.getConversations);
router.get("/conversations/:conversationId", auth, whatsappChatController.getMessages);
router.post("/conversations/:conversationId/send", auth, whatsappChatController.sendChatMessage);
router.put("/conversations/:conversationId/bot-mode", auth, whatsappChatController.setBotMode);
// Conversions API for Business Messaging: mark a Click-to-WhatsApp ad chat as a lead or a sale.
router.get("/conversations/:conversationId/conversion", auth, whatsappConversionController.getConversion);
router.post("/conversations/:conversationId/conversion", auth, whatsappConversionController.markConversion);
router.post("/upload-media", auth, uploadWhatsAppMedia.single("media"), templateController.uploadMedia);

module.exports = router;
