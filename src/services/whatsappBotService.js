const OpenAI = require("openai");
const whatsappChatbotConfigModel = require("../models/whatsappChatbotConfigModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const whatsappConversationModel = require("../models/whatsappConversationModel");
const whatsappMessageModel = require("../models/whatsappMessageModel");
const whatsappCloudApiService = require("./whatsappCloudApiService");
const logger = require("../utils/logger");
const chatbotAccess = require("./whatsappChatbotAccess");

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

function tidyReply(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitClauses(text) {
  const clean = String(text || "").replace(/[:,\s]+$/, "").trim();
  if (clean.length < 40) return null;
  const parts = clean
    .split(/,\s+/)
    .map((part) => part.replace(/\.$/, "").trim())
    .filter((part) => part.length > 8);
  if (parts.length < 3) return null;
  return parts.map((part, index) => `${index + 1}. ${part}`).join("\n");
}

function arrangeReply(text) {
  const raw = tidyReply(text);
  if (!raw) return raw;
  if ((raw.match(/\n/g) || []).length >= 2) return raw;

  const planRe = /(?:^|[,:]|\baur\b)\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s*₹\s*([\d,]+)(?:\s*\(([^)]+)\))?/g;
  const plans = [];
  let match;
  let firstIndex = -1;
  while ((match = planRe.exec(raw))) {
    if (firstIndex < 0) firstIndex = match.index;
    plans.push({
      name: match[1].trim(),
      price: match[2],
      detail: String(match[3] || "").trim(),
    });
  }

  if (plans.length >= 2) {
    const lines = [];
    const intro = firstIndex > 0
      ? raw.slice(0, firstIndex).replace(/(?:packages?|plans?)\s+(?:hain|hai)?\s*$/i, "").replace(/[:,.\s]+$/, "").trim()
      : "";
    const steps = splitClauses(intro);
    if (steps) lines.push("*Steps*", "", steps, "");
    lines.push("*Plans*", "");
    for (const plan of plans) {
      lines.push(`*${plan.name}*`);
      lines.push(plan.detail ? `₹${plan.price} · ${plan.detail}` : `₹${plan.price}`);
      lines.push("");
    }
    if (/kaunsa|inme se|koi bhi|which plan/i.test(raw)) lines.push("Which plan would you like?");
    return tidyReply(lines.join("\n"));
  }

  const steps = splitClauses(raw);
  if (steps) return tidyReply(`*Details*\n\n${steps}`);
  return raw;
}

async function generateAiReply({ textBody, config, customerName, history, matchedFaq }) {
  const client = openai();
  const fallback = config.fallbackMessage || "Thanks for your message. A team member will get back to you shortly.";
  if (!client) return fallback;

  const faqBlock = (config.faqs || [])
    .slice(0, 30)
    .map((f, i) => `${i + 1}. Q: ${f.question}\nA: ${f.answer}`)
    .join("\n");

  const system = [
    `You are the WhatsApp AI agent for ${config.businessName || "this business"}.`,
    matchedFaq
      ? "A saved FAQ matches this message. Answer from that FAQ only."
      : "No saved FAQ matched. Answer from the business instructions and FAQs below.",
    "Use only the business name, extra instructions, and FAQs below. Do not invent prices, timings, or offers.",
    "If the message is outside that knowledge, or you are unsure, reply with the fallback message only. Do not answer jokes, math, or word games.",
    "A short yes, ha, yahi, okay, or kardo means they accepted the plan already shown.",
    "Never send the same message twice. Do not repeat the plan card. Tell only the next step: open Create Ad, choose that package, and pay.",
    "Do not say an order has started. Chat cannot place the order.",
    "Reply in English.",
    "Arrange the reply like a WhatsApp card from the first line. Do not write plans, steps, or options in one paragraph.",
    "Put each plan or step on its own line. A plan name can be wrapped in *asterisks*. Keep a blank line between plans.",
    "Example:\n*Plans*\n\n*Launch*\n₹1499 · 3 days\n\n*Scale*\n₹2000 · 3 days\n\nWhich plan would you like?",
    matchedFaq
      ? `Saved FAQ for this question. Keep every price, time, and fact exactly, and write the answer in English.\nQ: ${matchedFaq.question}\nA: ${matchedFaq.answer}`
      : "",
    config.businessName ? `Business name: ${config.businessName}.` : "",
    config.systemPrompt ? `Extra instructions: ${config.systemPrompt}` : "",
    faqBlock ? `FAQs:\n${faqBlock}` : "No FAQs configured.",
    `Fallback message: ${fallback}`,
  ]
    .filter(Boolean)
    .join("\n");

  const historyMessages = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
        .slice(-6)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 500) }))
    : [];

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 420,
      messages: [
        { role: "system", content: system },
        ...historyMessages,
        {
          role: "user",
          content: `Customer${customerName ? ` (${customerName})` : ""} said: ${textBody}`,
        },
      ],
    });
    const reply = arrangeReply(String(completion.choices?.[0]?.message?.content || "").trim());
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

    const accounts = await whatsappAccountModel
      .find({
        phoneNumberId: phoneNumberId || conversation.phoneNumberId,
        status: "CONNECTED",
      })
      .limit(2);
    if (accounts.length !== 1 || !accounts[0].userId) return;
    const account = accounts[0];

    const chatbotPlan = await chatbotAccess.findActive(account.userId);
    if (!chatbotPlan) return;

    const config = await whatsappChatbotConfigModel.findOne({ userId: account.userId });
    if (!config || config.enabled !== true) return;

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
    const recent = await whatsappMessageModel
      .find({ conversationId: conversation._id })
      .sort({ createdAt: -1 })
      .limit(6)
      .select("direction textBody")
      .lean();
    const history = recent
      .reverse()
      .map((m) => ({
        role: m.direction === "INBOUND" ? "user" : "assistant",
        content: String(m.textBody || "").trim(),
      }))
      .filter((m) => m.content && !m.content.startsWith("["));
    if (history.length && history[history.length - 1].role === "user" && history[history.length - 1].content === text) {
      history.pop();
    }
    const taken = await chatbotAccess.consumeReply(account.userId);
    if (!taken.ok) return;

    let aiReply;
    try {
      aiReply = await generateAiReply({
        textBody: text,
        config: effectiveConfig,
        customerName: conversation.customerName,
        matchedFaq: faq,
        history,
      });
    } catch (err) {
      await chatbotAccess.refundReply(account.userId, taken.source, taken.amount);
      throw err;
    }
    const lastBot = [...history].reverse().find((m) => m.role === "assistant");
    const compact = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9₹\u0900-\u097f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const previous = compact(lastBot?.content);
    const next = compact(aiReply);
    if (previous && next && (previous === next || previous.includes(next) || next.includes(previous))) {
      aiReply = "This plan was already shared. Open Create Ad in the app, choose this package, and pay.";
    }
    try {
      await sendBotText({ account, conversation, text: aiReply });
    } catch (err) {
      await chatbotAccess.refundReply(account.userId, taken.source, taken.amount);
      throw err;
    }
  } catch (err) {
    logger.error("[whatsappBot] handleInbound failed", { message: err?.message || String(err) });
    console.error("[whatsappBot] handleInbound failed:", err?.message || err);
  }
}

/**
 * When the agent flips a chat to AI, answer the customer's latest message.
 * The switch used to only save a flag, so an already-open chat never got a reply.
 */
async function answerPendingWithAi(conversation) {
  if (!conversation || conversation.isBotActive === false) return null;

  const last = await whatsappMessageModel
    .findOne({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .lean();
  if (!last || last.direction !== "INBOUND") return null;

  const text = String(last.textBody || "").trim();
  if (!text || text.startsWith("[")) return null;

  // Same path as a live customer message: greeting, then FAQ, then business-only AI.
  await handleInbound({
    conversation,
    textBody: text,
    phoneNumberId: conversation.phoneNumberId,
    msgType: "TEXT",
  });
  return true;
}

module.exports = {
  handleInbound,
  answerPendingWithAi,
  generateAiReply,
  arrangeReply,
  matchFaq,
  matchesHandoff,
};
