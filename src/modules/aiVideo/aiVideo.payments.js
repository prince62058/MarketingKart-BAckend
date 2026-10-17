const crypto = require("crypto");
const Razorpay = require("razorpay");
const logger = require("../../utils/logger");

const UNAVAILABLE = "Payments are unavailable right now. Please try again in a few minutes.";

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

// The key id is public (the app needs it to open checkout); the secret never leaves this file.
function publicKeyId() {
  return process.env.RAZORPAY_KEY_ID || null;
}

let cached = { keyId: null, secret: null, client: null };

function client() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) {
    logger.error("[AI VIDEO] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set");
    throw httpError(503, UNAVAILABLE);
  }
  if (!cached.client || cached.keyId !== keyId || cached.secret !== secret) {
    const sdk = new Razorpay({ key_id: keyId, key_secret: secret });
    // Lets the isolated tests talk to a local stand-in instead of the real API.
    if (process.env.RAZORPAY_API_BASE_URL) sdk.api.rq.defaults.baseURL = process.env.RAZORPAY_API_BASE_URL;
    cached = { keyId, secret, client: sdk };
  }
  return cached.client;
}

// The SDK rejects with a plain `{ statusCode, error }` object (or a TypeError when the network
// is down), neither of which is safe or useful to show a customer. A 4xx from Razorpay means the
// request itself was refused (a definitive answer); anything else is worth retrying.
async function call(label, run) {
  try {
    return await run(client());
  } catch (error) {
    if (error instanceof Error && error.status) throw error;
    const status = error && error.statusCode;
    const detail = (error && error.error && (error.error.description || error.error.code)) || (error && error.message) || "unknown";
    logger.error(`[AI VIDEO] Razorpay ${label} failed (${status || "network"}): ${detail}`);
    if (status >= 400 && status < 500 && status !== 429) throw httpError(400, "We could not verify this payment with the bank.");
    throw httpError(503, UNAVAILABLE);
  }
}

function createOrder({ amountPaise, receipt, notes }) {
  return call("create order", sdk => sdk.orders.create({ amount: amountPaise, currency: "INR", receipt, notes }));
}

function fetchPayment(paymentId) {
  return call("fetch payment", sdk => sdk.payments.fetch(paymentId));
}

function capturePayment(paymentId, amountPaise) {
  return call("capture payment", sdk => sdk.payments.capture(paymentId, amountPaise, "INR"));
}

function safeEqualHex(expected, given) {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

// Checks the signature the app receives from Razorpay Checkout: HMAC-SHA256 of "order|payment".
function verifySignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !orderId || !paymentId) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

function webhookConfigured() {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}

// Webhooks are signed over the exact bytes Razorpay sent, with a secret set in their dashboard.
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !rawBody) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

const titleCase = text => String(text || "").replace(/^./, letter => letter.toUpperCase());

// What the confirmation screen shows next to "Payment Method".
function describeMethod(payment) {
  switch (payment && payment.method) {
    case "card": {
      const card = payment.card || {};
      return card.last4 ? `${card.network || "Card"} •••• ${card.last4}` : "Card";
    }
    case "upi":
      return payment.vpa ? `UPI • ${payment.vpa}` : "UPI";
    case "wallet":
      return payment.wallet ? `Wallet • ${titleCase(payment.wallet)}` : "Wallet";
    case "netbanking":
      return payment.bank ? `Netbanking • ${payment.bank}` : "Netbanking";
    default:
      return "Razorpay";
  }
}

module.exports = {
  UNAVAILABLE,
  isConfigured,
  publicKeyId,
  createOrder,
  fetchPayment,
  capturePayment,
  verifySignature,
  webhookConfigured,
  verifyWebhookSignature,
  describeMethod,
};
