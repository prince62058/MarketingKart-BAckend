// Welcome WhatsApp: when someone signs in to a MarketingKart product, the company's own
// WhatsApp number sends them that product's approved image template — once per number per product.
//
// Config (all optional; nothing is sent until the sender is set):
//   WELCOME_WHATSAPP_PHONE_NUMBER_ID  phone number id of the company number (connected in the panel)
//   WELCOME_CALL_NUMBER               number for the "Call" button, e.g. +919111155016 (else a quick reply)
//   PUBLIC_API_URL                    where /images is served (default https://api.marketingkart.in)
const Account = require("../models/whatsappAccountModel");
const Welcome = require("../models/whatsappWelcomeModel");
const cloud = require("./whatsappCloudApiService");

const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.marketingkart.app";
const LANGUAGE = "en";
const FOOTER = "MarketingKart.ai – AI-Powered Marketing Platform";
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/** Template copy per product. Body {{1}} is the person's first name. */
const PRODUCTS = {
  meta_ads: {
    template: "mk_welcome_meta_ads",
    image: "/images/welcome/meta.jpg",
    body:
      "Hi {{1}}, welcome to MarketingKart.ai! 🎉\n\n" +
      "Get daily new customers from Facebook and Instagram ads. We design, run and manage your ads for you.\n\n" +
      "✅ Trial ad at just ₹1,499 (ad spend, design and GST included)\n" +
      "✅ No marketing skills needed\n" +
      "✅ Dedicated account manager\n\n" +
      "Offer valid for the first 500 customers only.",
    url: { text: "Get My ₹1,499 Ad", url: PLAY_STORE },
    call: "Call Account Manager",
  },
  whatsapp: {
    template: "mk_welcome_whatsapp",
    image: "/images/welcome/whatsapp.jpg",
    body:
      "Hi {{1}}, welcome to MarketingKart.ai WhatsApp Marketing! 🎉\n\n" +
      "Send offers to all your customers on the official WhatsApp Business API.\n\n" +
      "✅ Bulk campaigns with images, videos and buttons\n" +
      "✅ Chatbots and a 24×7 AI agent\n" +
      "✅ One shared inbox for your whole team\n\n" +
      "Connect your number and send your first campaign today.",
    url: { text: "Open WhatsApp Panel", url: "https://wa.marketingkart.in" },
    call: "Talk to an Expert",
  },
  ai_video: {
    template: "mk_welcome_ai_video",
    image: "/images/welcome/ai_video.jpg",
    body:
      "Hi {{1}}, welcome to MarketingKart.ai AI Video! 🎬\n\n" +
      "Turn any script into a talking avatar video in minutes.\n\n" +
      "✅ Make an avatar from your photo\n" +
      "✅ Clone your own voice\n" +
      "✅ Hindi, English and more\n\n" +
      "No camera, no studio. Open AI Video in the app and create your first video.",
    url: { text: "Create My Video", url: PLAY_STORE },
    call: "Talk to an Expert",
  },
};

const publicBase = () => String(process.env.PUBLIC_API_URL || "https://api.marketingkart.in").replace(/\/+$/, "").replace(/\/api$/, "");
const imageUrl = (product) => `${publicBase()}${PRODUCTS[product].image}`;

function callNumber() {
  const raw = String(process.env.WELCOME_CALL_NUMBER || "").replace(/[^\d+]/g, "");
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const full = digits.length === 10 ? `91${digits}` : digits;
  return /^\d{11,15}$/.test(full) ? `+${full}` : null;
}

/** The Meta components to create a product's template (header sample is filled at upload). */
function templateComponents(product, { headerSample } = {}) {
  const p = PRODUCTS[product];
  const phone = callNumber();
  const second = phone
    ? { type: "PHONE_NUMBER", text: p.call, phone_number: phone }
    : { type: "QUICK_REPLY", text: "Talk to an Expert" };
  return [
    { type: "HEADER", format: "IMAGE", example: { header_handle: [headerSample || imageUrl(product)] } },
    { type: "BODY", text: p.body, example: { body_text: [["Rahul"]] } },
    { type: "FOOTER", text: FOOTER },
    // Meta wants quick replies after call-to-action buttons.
    { type: "BUTTONS", buttons: [{ type: "URL", text: p.url.text, url: p.url.url }, second] },
  ];
}

/** What a send fills in: the header image and the first name. */
function sendComponents(product, name) {
  const first = String(name || "").trim().split(/\s+/)[0];
  const safe = first && !/^user\b/i.test(first) && first.length <= 30 ? first : "there";
  return [
    { type: "header", parameters: [{ type: "image", image: { link: imageUrl(product) } }] },
    { type: "body", parameters: [{ type: "text", text: safe }] },
  ];
}

function phoneOf(user) {
  const digits = String(user?.mobile || user?.phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

async function senderCredentials() {
  const phoneNumberId = String(process.env.WELCOME_WHATSAPP_PHONE_NUMBER_ID || "").trim();
  if (!phoneNumberId) return null;
  const account = await Account.findOne({ phoneNumberId, status: "CONNECTED" });
  if (!account?.accessToken) return null;
  return { accessToken: account.accessToken, phoneNumberId, wabaId: account.wabaId };
}

/**
 * Sends the welcome for `product` to this user, once per number. Never throws.
 * Returns what happened, for logs and tests.
 */
async function sendWelcome(user, product) {
  try {
    if (!PRODUCTS[product]) return { skipped: "unknown product" };
    if (!user || ["ADMIN", "SUBADMIN", "SUBUSER"].includes(String(user.userType || "").toUpperCase())) return { skipped: "not a customer" };
    const phone = phoneOf(user);
    if (!phone) return { skipped: "no phone" };
    const credentials = await senderCredentials();
    if (!credentials) return { skipped: "no sender configured" };

    // Claim this number+product so two logins at once send one message. A failed try may retry later.
    const now = new Date();
    let claim;
    try {
      claim = await Welcome.findOneAndUpdate(
        { phone, product, $or: [{ status: "FAILED", updatedAt: { $lt: new Date(now - RETRY_AFTER_MS) } }] },
        { $set: { status: "SENDING", userId: user._id || null, template: PRODUCTS[product].template }, $inc: { attempts: 1 } },
        { new: true }
      );
      if (!claim) {
        claim = await Welcome.create({ phone, product, userId: user._id || null, template: PRODUCTS[product].template, attempts: 1 });
      }
    } catch (error) {
      if (error?.code === 11000) return { skipped: "already welcomed" };
      throw error;
    }

    try {
      const result = await cloud.sendTemplateMessage(phone, PRODUCTS[product].template, LANGUAGE, sendComponents(product, user.name), credentials);
      const wamid = result?.messages?.[0]?.id || null;
      await Welcome.updateOne({ _id: claim._id }, { $set: { status: "SENT", wamid, sentAt: new Date(), error: "" } });
      return { sent: true, wamid };
    } catch (error) {
      await Welcome.updateOne({ _id: claim._id }, { $set: { status: "FAILED", error: String(error?.message || error).slice(0, 500) } });
      return { failed: error?.message || String(error) };
    }
  } catch (error) {
    console.error("[welcome whatsapp]", error?.message || error);
    return { failed: error?.message || String(error) };
  }
}

/** Fire-and-forget from a request handler: the login answer never waits for WhatsApp. */
function triggerWelcome(user, product) {
  if (!user || !PRODUCTS[product]) return;
  setImmediate(() => {
    sendWelcome(user, product).then((r) => {
      if (r?.failed) console.warn(`[welcome whatsapp] ${product} not sent: ${r.failed}`);
    });
  });
}

/** Login body/product names the apps send. */
function productFrom(value, fallback = null) {
  const v = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["whatsapp", "whatsapp_marketing", "wa"].includes(v)) return "whatsapp";
  if (["meta_ads", "meta", "ads", "marketingkart"].includes(v)) return "meta_ads";
  if (["ai_video", "aivideo", "video"].includes(v)) return "ai_video";
  return fallback;
}

module.exports = { PRODUCTS, templateComponents, sendComponents, sendWelcome, triggerWelcome, productFrom, phoneOf, imageUrl, callNumber, senderCredentials, LANGUAGE };
