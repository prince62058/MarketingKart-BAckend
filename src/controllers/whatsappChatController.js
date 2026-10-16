const whatsappConversationModel = require("../models/whatsappConversationModel");
const whatsappMessageModel = require("../models/whatsappMessageModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const whatsappCloudApiService = require("../services/whatsappCloudApiService");
const businessModel = require("../models/businessModel");
const axios = require("axios");
const { cleanText, previewText, isGenericLabel } = require("../services/whatsappChatFormat");

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const publicBase = () => (process.env.PUBLIC_API_URL || "https://api.marketingkart.in").replace(/\/$/, "");
// Meta serves WhatsApp media from its own CDN hosts only.
const META_MEDIA_HOST = /^https:\/\/[^/]+\.(fbsbx\.com|fbcdn\.net|whatsapp\.net|facebook\.com)\//i;

// Shape one stored message for the app. Media synced from the Business App has only a media id,
// so it is served through the authenticated proxy below instead of an expiring Meta URL.
const mapMessage = (m) => {
  const obj = m.toObject ? m.toObject() : { ...m };
  const text = cleanText(obj.textBody || "");
  obj.textBody = text;
  obj.content = obj.type === "MEDIA" && isGenericLabel(text) ? "" : text;
  obj.messageType = obj.type === "MEDIA" ? String(obj.mediaType || "image").toUpperCase() : (obj.type || "TEXT");
  if (!obj.mediaUrl && obj.mediaId) obj.mediaUrl = `${publicBase()}/api/whatsapp/chat/media/${obj._id}`;
  obj.mediaUrl = obj.mediaUrl || null;
  obj.mediaType = obj.mediaType || null;
  obj.senderType = obj.direction === "OUTBOUND" ? "USER" : "CONTACT";
  return obj;
};

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
    const { search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const skip = (page - 1) * limit;

    // Find all businesses owned by the current user
    const userBusinesses = await businessModel.find({ userId: req.user._id }).select("_id");
    const businessIds = userBusinesses.map((b) => b._id);

    // Filter conversations by user's businesses
    const query = { businessId: { $in: businessIds } };

    if (search) {
      const pattern = new RegExp(escapeRegex(String(search).slice(0, 60)), "i");
      query.$or = [{ customerName: pattern }, { customerPhone: pattern }];
    }

    const conversations = await whatsappConversationModel
      .find(query)
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await whatsappConversationModel.countDocuments(query);

    const mappedConversations = conversations.map((c) => {
      const obj = c.toObject ? c.toObject() : { ...c };
      obj.contactPhone = obj.customerPhone;
      obj.contactName = obj.customerName && obj.customerName !== "Unknown" ? obj.customerName : obj.customerPhone;
      obj.lastMessage = previewText(obj.lastMessage);
      return obj;
    });

    return res.status(200).json({
      success: true,
      data: mappedConversations,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + conversations.length < total,
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
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const before = req.query.before ? new Date(req.query.before) : null;

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
    const and = [{
      $or: [
        { conversationId },
        ...(phoneVariants.length ? [{ to: { $in: phoneVariants } }] : []),
      ],
    }];
    if (before && !Number.isNaN(before.getTime())) {
      and.push({ $or: [{ sentAt: { $lt: before } }, { sentAt: null, createdAt: { $lt: before } }] });
    }
    const messageQuery = {
      phoneNumberId: conversation.phoneNumberId,
      businessId: { $in: (await businessModel.find({userId:req.user._id}).select("_id")).map(b=>b._id) },
      $and: and,
    };

    // Newest page first so long chats open at their latest messages; the app asks for older
    // pages with `before`. The page is returned oldest-to-newest for display.
    const page = await whatsappMessageModel
      .find(messageQuery)
      .sort({ sentAt: -1, createdAt: -1 })
      .limit(limit + 1);
    const hasMore = page.length > limit;
    const messages = page.slice(0, limit).reverse();
    const oldest = messages[0];

    return res.status(200).json({
      success: true,
      data: messages.map(mapMessage),
      hasMore,
      nextBefore: hasMore && oldest ? (oldest.sentAt || oldest.createdAt) : null
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Streams a synced message's media (photo, voice note, document...) to its owner.
exports.getMedia = async (req, res) => {
  try {
    const message = await whatsappMessageModel.findById(req.params.messageId);
    if (!message || !message.mediaId) {
      return res.status(404).json({ success: false, message: "Media not found" });
    }
    const owner = await businessModel.findOne({ _id: message.businessId, userId: req.user._id }).select("_id");
    if (!owner) {
      return res.status(403).json({ success: false, message: "You do not have access to this media" });
    }
    const account = await whatsappAccountModel.findOne({
      userId: req.user._id,
      phoneNumberId: message.phoneNumberId,
      status: "CONNECTED",
    });
    if (!account) {
      return res.status(404).json({ success: false, message: "WhatsApp account not connected" });
    }

    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const version = process.env.META_GRAPH_API_VERSION || "v22.0";
    const meta = await axios.get(`https://graph.facebook.com/${version}/${message.mediaId}`, { headers, timeout: 15000 });
    const url = meta.data?.url;
    if (!url || !META_MEDIA_HOST.test(url)) {
      return res.status(404).json({ success: false, message: "Media is no longer available" });
    }
    const file = await axios.get(url, {
      headers,
      responseType: "stream",
      timeout: 30000,
      maxContentLength: 25 * 1024 * 1024,
    });
    res.set({
      "Content-Type": meta.data?.mime_type || file.headers["content-type"] || "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    file.data.pipe(res);
  } catch (error) {
    // Media ids expire (about 30 days; Business App history only carries recent media).
    const status = error.response?.status === 400 || error.response?.status === 404 ? 404 : 502;
    if (!res.headersSent) {
      return res.status(status).json({ success: false, message: "Media is no longer available" });
    }
    res.end();
  }
};

// Progress of the Business App chat import, for the inbox banner.
exports.getSyncStatus = async (req, res) => {
  try {
    const account = await whatsappAccountModel.findOne({ userId: req.user._id, status: "CONNECTED" });
    if (!account) {
      return res.status(200).json({ success: true, data: { connected: false } });
    }
    const businessIds = (await businessModel.find({ userId: req.user._id }).select("_id")).map((b) => b._id);
    const scope = { phoneNumberId: account.phoneNumberId, businessId: { $in: businessIds } };
    const [conversations, messages] = await Promise.all([
      whatsappConversationModel.countDocuments(scope),
      whatsappMessageModel.countDocuments(scope),
    ]);
    const sync = account.coexistenceSync || {};
    const isBusinessApp = account.onboardingMode === "BUSINESS_APP";
    const historyStatus = sync.historyStatus || null;
    return res.status(200).json({
      success: true,
      data: {
        connected: true,
        isBusinessApp,
        phoneNumber: account.phoneNumber,
        historyStatus,
        historyProgress: sync.historyProgress || 0,
        contactsRequested: Boolean(sync.contactsRequestedAt),
        syncing: isBusinessApp && historyStatus === "REQUESTED",
        conversations,
        messages,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not read chat sync status" });
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
      userId: req.user._id,
      phoneNumberId: conversation.phoneNumberId,
      status: 'CONNECTED',
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
    // 131047: the customer last wrote more than 24 hours ago, so only a template may be sent.
    if (String(error.code) === "131047") {
      return res.status(400).json({
        success: false,
        code: "REPLY_WINDOW_CLOSED",
        message: "The 24-hour reply window has closed. Send an approved template message to restart the chat, or reply from WhatsApp Business.",
      });
    }
    return res.status(500).json({ success: false, message: error.message || "Failed to send chat message" });
  }
};
