const express = require("express");
const router = express.Router();
const whatsappChatController = require("../controllers/whatsappChatController");
const { authUser: auth } = require("../middlewares/authMidd");

const { uploadWhatsAppMedia } = require("../middlewares/multer");
const templateController = require("../controllers/whatsappTemplateController");

router.get("/conversations", auth, whatsappChatController.getConversations);
router.get("/conversations/:conversationId", auth, whatsappChatController.getMessages);
router.post("/conversations/:conversationId/send", auth, whatsappChatController.sendChatMessage);
router.put("/conversations/:conversationId/bot-mode", auth, whatsappChatController.setBotMode);
router.post("/upload-media", auth, uploadWhatsAppMedia.single("media"), templateController.uploadMedia);

module.exports = router;
