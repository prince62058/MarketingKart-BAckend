const OpenAI = require("openai");
const whatsappChatbotConfigModel = require("../models/whatsappChatbotConfigModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const whatsappConversationModel = require("../models/whatsappConversationModel");
const whatsappMessageModel = require("../models/whatsappMessageModel");
const whatsappCloudApiService = require("./whatsappCloudApiService");
const logger = require("../utils/logger");

let openaiClient = null;
function openai() {
  if (!process.env.OPENAI_API_KEY) return null;
  openaiClient = openaiClient || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const DEFAULT_HANDOFF = whatsappChatbotConfigModel.DEFAULT_HANDOFF || [
  "human",
  "agent",
  "talk to person",
  "speak to someone",
  "talk to human",
  "customer care",
  "insan",
  "agent se baat",
];

function matchesHandoff(text, keywords) {
  const normalized = normalize(text);
  if (!normalized) return false;
  const list = Array.isArray(keywords) && keywords.length ? keywords : DEFAULT_HANDOFF;
  return list.some((kw) => {
    const needle = normalize(kw);
    return needle && (normalized === needle || normalized.includes(needle));
  });
}

function matchFaq(text, faqs) {
  if (!Array.isArray(faqs) || !faqs.length) return null;
  const normalized = normalize(text);
  if (!normalized) return null;

  let best = null;
  let bestScore = 0;

  for (const faq of faqs) {
    const question = normalize(faq.question);
    const keywords = Array.isArray(faq.keywords) ? faq.keywords.map(normalize).filter(Boolean) : [];
    let score = 0;

    if (question && (normalized === question || normalized.includes(question) || question.includes(normalized))) {
      score += 10;
    }
    for (const kw of keywords) {
      if (normalized.includes(kw) || kw.includes(normalized)) score += 4;
    }
    // Token overlap with question
    if (question) {
      const qTokens = question.split(" ").filter((t) => t.length > 2);
      const hits = qTokens.filter((t) => normalized.includes(t)).length;
      if (qTokens.length) score += (hits / qTokens.length) * 6;
    }

    if (score > bestScore) {
      bestScore = score;
      best = faq;
    }
  }

  return bestScore >= 4 ? best : null;
}

async function generateAiReply({ textBody, config, customerName }) {
  const client = openai();
  const fallback = config.fallbackMessage || "Thanks for your message. A team member will get back to you shortly.";
  if (!client) return fallback;

  const faqBlock = (config.faqs || [])
    .slice(0, 30)
    .map((f, i) => `${i + 1}. Q: ${f.question}\nA: ${f.answer}`)
    .join("\n");

  const system = [
    "You are a helpful WhatsApp business assistant.",
    "Reply in short or medium length (1–3 short sentences). Plain text only — no markdown.",
    "Use the business knowledge and FAQs. If you do not know, say so briefly and offer human help.",
    "Match the customer's language when possible (English or Hinglish).",
    config.businessName ? `Business name: ${config.businessName}.` : "",
    config.systemPrompt ? `Extra instructions: ${config.systemPrompt}` : "",
    faqBlock ? `FAQs:\n${faqBlock}` : "No FAQs configured.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 220,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Customer${customerName ? ` (${customerName})` : ""} said: ${textBody}`,
        },
      ],
    });
    const reply = String(completion.choices?.[0]?.message?.content || "").trim();
    return reply || fallback;
  } catch (err) {
    logger.error("[whatsappBot] OpenAI failed", { message: err?.message || String(err) });
    return fallback;
  }
}

function emitBotMessage({ account, conversation, message, textBody }) {
  if (!global.io) return;

  const convObj = {
    _id: String(conversation._id),
    businessId: conversation.businessId,
    customerPhone: conversation.customerPhone,
    customerName:
      conversation.customerName && conversation.customerName !== "Unknown"
        ? conversation.customerName
        : conversation.customerPhone,
    contactPhone: conversation.customerPhone,
    contactName:
      conversation.customerName && conversation.customerName !== "Unknown"
        ? conversation.customerName
        : conversation.customerPhone,
    lastMessage: String(textBody).substring(0, 50),
    lastMessageAt: conversation.lastMessageAt || new Date(),
    unreadCount: conversation.unreadCount || 0,
    status: conversation.status || "OPEN",
    isBotActive: conversation.isBotActive ?? true,
  };

  const payload = {
    conversationId: String(conversation._id),
    customerPhone: conversation.customerPhone,
    customerName: convObj.customerName,
    textBody,
    content: textBody,
    direction: "OUTBOUND",
    type: "TEXT",
    messageType: "TEXT",
    status: "SENT",
    senderType: "BOT",
    source: "BOT",
    createdAt: message.createdAt || new Date(),
    sentAt: message.sentAt || new Date(),
    _id: String(message._id),
    message,
    conversation: convObj,
  };

  if (conversation.businessId) {
    global.io.to(`business:${conversation.businessId}`).emit("newWhatsAppMessage", payload);
    global.io.to(`business:${conversation.businessId}`).emit("conversationUpdated", convObj);
  }
  if (account?.userId) {
    global.io.to(`user:${account.userId}`).emit("newWhatsAppMessage", payload);
    global.io.to(`user:${account.userId}`).emit("conversationUpdated", convObj);
  }
  global.io.to(`conversation:${conversation._id}`).emit("newWhatsAppMessage", payload);
  global.io.to(`conversation:${conversation._id}`).emit("chatMessage", payload);
}

function emitConversationUpdated(account, conversation) {
  if (!global.io) return;
  const convObj = {
    _id: String(conversation._id),
    businessId: conversation.businessId,
    customerPhone: conversation.customerPhone,
    customerName:
      conversation.customerName && conversation.customerName !== "Unknown"
        ? conversation.customerName
        : conversation.customerPhone,
    contactPhone: conversation.customerPhone,
    contactName:
      conversation.customerName && conversation.customerName !== "Unknown"
        ? conversation.customerName
        : conversation.customerPhone,
    lastMessage: conversation.lastMessage,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: conversation.unreadCount || 0,
    status: conversation.status || "OPEN",
    isBotActive: conversation.isBotActive ?? true,
  };
  if (conversation.businessId) {
    global.io.to(`business:${conversation.businessId}`).emit("conversationUpdated", convObj);
  }
  if (account?.userId) {
    global.io.to(`user:${account.userId}`).emit("conversationUpdated", convObj);
  }
  global.io.to(`conversation:${conversation._id}`).emit("conversationUpdated", convObj);
}

async function sendBotText({ account, conversation, text }) {
  const body = String(text || "").trim().slice(0, 4000);
  if (!body) return null;

  const credentials = {
    accessToken: account.accessToken,
    phoneNumberId: account.phoneNumberId,
  };

  const metaResponse = await whatsappCloudApiService.sendTextMessage(
    conversation.customerPhone,
    body,
    credentials
  );
  const wamid = metaResponse.messages?.[0]?.id;

  const message = await whatsappMessageModel.create({
    conversationId: conversation._id,
    businessId: conversation.businessId,
    phoneNumberId: conversation.phoneNumberId,
    to: conversation.customerPhone,
    contactName: conversation.customerName,
    direction: "OUTBOUND",
    type: "TEXT",
    textBody: body,
    source: "BOT",
    metaMessageId: wamid,
    status: "SENT",
    sentAt: new Date(),
  });

  conversation.lastMessage = body.substring(0, 50);
  conversation.lastMessageAt = new Date();
  await conversation.save();

  emitBotMessage({ account, conversation, message, textBody: body });
  return message;
}

/**
 * Fire-and-forget friendly: FAQ first, then OpenAI, when conversation is in AI mode.
 */
async function handleInbound({ conversation, textBody, phoneNumberId, msgType }) {
  try {
    if (!conversation || conversation.isBotActive === false) return;
    if (msgType && msgType !== "TEXT") return;

    const text = String(textBody || "").trim();
    if (!text) return;

    const account = await whatsappAccountModel.findOne({
      phoneNumberId: phoneNumberId || conversation.phoneNumberId,
      status: "CONNECTED",
    });
    if (!account?.userId) return;

    const config = await whatsappChatbotConfigModel.findOne({ userId: account.userId });
    if (config && config.enabled === false) return;

    const effectiveConfig = config || {
      enabled: true,
      businessName: account.businessName || account.verifiedName || "",
      greeting: "Hi! Thanks for messaging us. How can we help you today?",
      fallbackMessage: "Thanks for your message. A team member will get back to you shortly.",
      faqs: [],
      handoffKeywords: DEFAULT_HANDOFF,
      systemPrompt: "",
    };

    // Human handoff
    if (matchesHandoff(text, effectiveConfig.handoffKeywords)) {
      conversation.isBotActive = false;
      await conversation.save();
      emitConversationUpdated(account, conversation);
      await sendBotText({
        account,
        conversation,
        text: "Connecting you to a team member. Someone will reply shortly.",
      });
      return;
    }

    // Greeting on short hellos when no FAQ hit
    const normalized = normalize(text);
    const isGreeting = /^(hi|hello|hey|namaste|namaskar|hii|helo)\b/.test(normalized);
    if (isGreeting && effectiveConfig.greeting) {
      const faqHit = matchFaq(text, effectiveConfig.faqs);
      if (!faqHit) {
        await sendBotText({ account, conversation, text: effectiveConfig.greeting });
        return;
      }
    }

    const faq = matchFaq(text, effectiveConfig.faqs);
    if (faq?.answer) {
      await sendBotText({ account, conversation, text: faq.answer });
      return;
    }

    const aiReply = await generateAiReply({
      textBody: text,
      config: effectiveConfig,
      customerName: conversation.customerName,
    });
    await sendBotText({ account, conversation, text: aiReply });
  } catch (err) {
    logger.error("[whatsappBot] handleInbound failed", { message: err?.message || String(err) });
    console.error("[whatsappBot] handleInbound failed:", err?.message || err);
  }
}

module.exports = {
  handleInbound,
  matchFaq,
  matchesHandoff,
};
