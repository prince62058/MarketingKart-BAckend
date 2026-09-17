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

    const mappedConversations = conversations.map((c) => {
      const obj = c.toObject ? c.toObject() : { ...c };
      obj.contactPhone = obj.customerPhone;
      obj.contactName = obj.customerName && obj.customerName !== "Unknown" ? obj.customerName : obj.customerPhone;
      return obj;
    });

    return res.status(200).json({
      success: true,
      data: mappedConversations,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    console.error("[ChatController] Error in getConversations:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const userOwnsConversation = async (userId, conversation) => {
  if (!conversation) return false;
  const business = await businessModel.findOne({ _id: conversation.businessId, userId });
  return Boolean(business);
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
    if (!(await userOwnsConversation(req.user._id, conversation))) {
      return res.status(403).json({ success: false, message: "You do not have access to this conversation" });
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
      .sort({ sentAt: 1, createdAt: 1 }) // Chronological order: oldest first, newest at bottom
      .skip(skip)
      .limit(parseInt(limit));

    const mappedMessages = messages.map((m) => {
      const obj = m.toObject ? m.toObject() : { ...m };
      obj.content = obj.textBody || "";
      obj.messageType = obj.type === "MEDIA" ? (obj.mediaType || "IMAGE").toUpperCase() : (obj.type || "TEXT");
      obj.mediaUrl = obj.mediaUrl || null;
      obj.mediaType = obj.mediaType || null;
      obj.senderType = obj.direction === "OUTBOUND" ? "USER" : "CONTACT";
      return obj;
    });

    return res.status(200).json({
      success: true,
      data: mappedMessages
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.setBotMode = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { isBotActive } = req.body;
    if (typeof isBotActive !== "boolean") {
      return res.status(400).json({ success: false, message: "isBotActive (boolean) is required" });
    }

    const conversation = await whatsappConversationModel.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }
    if (!(await userOwnsConversation(req.user._id, conversation))) {
      return res.status(403).json({ success: false, message: "You do not have access to this conversation" });
    }

    conversation.isBotActive = isBotActive;
    await conversation.save();

    return res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendChatMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { text, mediaUrl, mediaType = "image", filename } = req.body;

    if (!text && !mediaUrl) {
      return res.status(400).json({ success: false, message: "Text content or mediaUrl is required" });
    }

    const conversation = await whatsappConversationModel.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }
    if (!(await userOwnsConversation(req.user._id, conversation))) {
      return res.status(403).json({ success: false, message: "You do not have access to this conversation" });
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

    let metaResponse;
    const isMedia = Boolean(mediaUrl);

    if (isMedia) {
      metaResponse = await whatsappCloudApiService.sendMediaMessage(
        conversation.customerPhone,
        mediaType,
        mediaUrl,
        text,
        credentials,
        filename
      );
    } else {
      metaResponse = await whatsappCloudApiService.sendTextMessage(
        conversation.customerPhone,
        text,
        credentials
      );
    }

    const wamid = metaResponse.messages?.[0]?.id;
    const msgType = isMedia ? "MEDIA" : "TEXT";
    const previewText = text || (isMedia ? `[${String(mediaType).toUpperCase()}]` : "");

    // Save to DB
    const message = await whatsappMessageModel.create({
      conversationId,
      businessId: conversation.businessId,
      phoneNumberId: conversation.phoneNumberId,
      to: conversation.customerPhone,
      contactName: conversation.customerName,
      direction: "OUTBOUND",
      type: msgType,
      mediaType: isMedia ? mediaType : undefined,
      mediaUrl: isMedia ? mediaUrl : undefined,
      textBody: previewText,
      metaMessageId: wamid,
      status: "SENT",
      sentAt: new Date()
    });

    // Update conversation lastMessage
    const updatedConv = await whatsappConversationModel.findByIdAndUpdate(conversationId, {
      lastMessage: previewText.substring(0, 50),
      lastMessageAt: new Date()
    }, { new: true });

    const convObj = {
      _id: String(conversation._id),
      businessId: conversation.businessId,
      customerPhone: conversation.customerPhone,
      customerName: conversation.customerName && conversation.customerName !== "Unknown" ? conversation.customerName : conversation.customerPhone,
      contactPhone: conversation.customerPhone,
      contactName: conversation.customerName && conversation.customerName !== "Unknown" ? conversation.customerName : conversation.customerPhone,
      lastMessage: previewText.substring(0, 50),
      lastMessageAt: updatedConv?.lastMessageAt || new Date(),
      unreadCount: conversation.unreadCount || 0,
      status: conversation.status || "OPEN",
      isBotActive: conversation.isBotActive ?? true,
    };

    const messagePayload = {
      _id: String(message._id),
      conversationId: String(conversation._id),
      customerPhone: conversation.customerPhone,
      customerName: convObj.customerName,
      textBody: previewText,
      content: previewText,
      mediaUrl: message.mediaUrl,
      mediaType: message.mediaType,
      direction: "OUTBOUND",
      senderType: "USER",
      type: msgType,
      messageType: isMedia ? (mediaType || "IMAGE").toUpperCase() : "TEXT",
      status: "SENT",
      createdAt: message.createdAt || new Date(),
      sentAt: message.sentAt || new Date(),
      message,
      conversation: convObj,
    };

    if (global.io) {
      if (conversation.businessId) {
        global.io.to(`business:${conversation.businessId}`).emit("newWhatsAppMessage", messagePayload);
        global.io.to(`business:${conversation.businessId}`).emit("conversationUpdated", convObj);
      }

      if (req.user?._id) {
        global.io.to(`user:${req.user._id}`).emit("newWhatsAppMessage", messagePayload);
        global.io.to(`user:${req.user._id}`).emit("conversationUpdated", convObj);
      }

      // Emit to conversation room (for live chat screen)
      global.io.to(`conversation:${conversation._id}`).emit("newWhatsAppMessage", messagePayload);
    }

    return res.status(201).json({
      success: true,
      message: "Message dispatched successfully",
      data: messagePayload
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to send chat message" });
  }
};
