const express = require("express");
const router = express.Router();
const whatsappChatController = require("../controllers/whatsappChatController");
const { authUser: auth } = require("../middlewares/authMidd");

router.get("/conversations", auth, whatsappChatController.getConversations);
router.get("/conversations/:conversationId", auth, whatsappChatController.getMessages);
router.post("/conversations/:conversationId/send", auth, whatsappChatController.sendChatMessage);
router.put("/conversations/:conversationId/bot-mode", auth, whatsappChatController.setBotMode);

module.exports = router;
