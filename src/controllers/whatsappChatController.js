const whatsappConversationModel = require("../models/whatsappConversationModel");
const whatsappMessageModel = require("../models/whatsappMessageModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const whatsappCloudApiService = require("../services/whatsappCloudApiService");
const businessModel = require("../models/businessModel");

const getPhoneVariants = (rawPhone) => {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (!digits) return [];

  const variants = new Set([digits, `+${digits}`]);

  if (digits.length === 10) {
    variants.add(`91${digits}`);
    variants.add(`+91${digits}`);
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    const local = digits.slice(2);
    variants.add(local);
    variants.add(`+${local}`);
  }

  return Array.from(variants);
};

exports.getConversations = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (page - 1) * limit;

    // Find all businesses owned by the current user
    const userBusinesses = await businessModel.find({ userId: req.user._id }).select("_id");
    const businessIds = userBusinesses.map((b) => b._id);

    // Filter conversations by user's businesses
    const query = { businessId: { $in: businessIds } };

    if (search) {
      query.$or = [
        { customerName: new RegExp(search, "i") },
        { customerPhone: new RegExp(search, "i") }
      ];
    }

    const conversations = await whatsappConversationModel
      .find(query)
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await whatsappConversationModel.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: conversations,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    console.error("[ChatController] Error in getConversations:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const conversation = await whatsappConversationModel.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    // Reset unread counts when fetched
    await whatsappConversationModel.findByIdAndUpdate(conversationId, { unreadCount: 0 });

    const phoneVariants = getPhoneVariants(conversation.customerPhone);
    const messageQuery = {
      $or: [
        { conversationId },
        ...(phoneVariants.length ? [{ to: { $in: phoneVariants } }] : []),
      ],
    };

    let messages = await whatsappMessageModel
      .find(messageQuery)
      .sort({ sentAt: -1, createdAt: -1 }) // NEWEST first, frontend should invert
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      data: messages
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendChatMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, message: "Text content is required" });
    }

    const conversation = await whatsappConversationModel.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const account = await whatsappAccountModel.findOne({
      $or: [
        { phoneNumberId: conversation.phoneNumberId },
        { wabaId: conversation.wabaId }
      ]
    });
    if (!account) {
      return res.status(404).json({ success: false, message: "WhatsApp Account not found for this conversation" });
    }

    const credentials = {
      accessToken: account.accessToken,
      phoneNumberId: account.phoneNumberId
    };

    // Send the message natively
    const metaResponse = await whatsappCloudApiService.sendTextMessage(
      conversation.customerPhone,
      text,
      credentials
    );

    const wamid = metaResponse.messages?.[0]?.id;

    // Save to DB
    const message = await whatsappMessageModel.create({
      conversationId,
      businessId: conversation.businessId,
      phoneNumberId: conversation.phoneNumberId,
      to: conversation.customerPhone,
      contactName: conversation.customerName,
      direction: "OUTBOUND",
      type: "TEXT",
      textBody: text,
      metaMessageId: wamid,
      status: "SENT",
      sentAt: new Date()
    });

    // Update conversation lastMessage
    await whatsappConversationModel.findByIdAndUpdate(conversationId, {
      lastMessage: text.substring(0, 50),
      lastMessageAt: new Date()
    });

    if (global.io && conversation.businessId) {
      global.io.to(`business:${conversation.businessId}`).emit("newWhatsAppMessage", {
        conversationId: conversation._id,
        customerPhone: conversation.customerPhone,
        textBody: text,
        direction: "OUTBOUND",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Message dispatched successfully",
      data: message
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to send chat message" });
  }
};
