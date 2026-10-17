const axios = require("axios");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function toProviderPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 10) return digits;
  throw new Error("Use a 10-digit Indian mobile number.");
}

function assertHttpsImage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Image URL must be a public HTTPS address.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Image URL must start with https://");
  }
  return parsed.toString();
}

function providerConfig() {
  return {
    configured: Boolean(
      process.env.BHASH_RCS_USER &&
        process.env.BHASH_RCS_PASS &&
        process.env.BHASH_RCS_SENDER,
    ),
    provider: "bhash",
    sender: process.env.BHASH_RCS_SENDER || "",
    messageType: "image",
  };
}

async function sendImageTemplate({ phone, templateName, imageUrl }) {
  const template = String(templateName || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(template)) {
    throw new Error("Enter the approved template id, for example bsl_image_demo.");
  }
  const params = new URLSearchParams({
    user: requiredEnv("BHASH_RCS_USER"),
    pass: requiredEnv("BHASH_RCS_PASS"),
    sender: requiredEnv("BHASH_RCS_SENDER"),
    phone: toProviderPhone(phone),
    text: template,
    priority: process.env.BHASH_RCS_PRIORITY || "rcs",
    stype: process.env.BHASH_RCS_STYPE || "normal",
    htype: "image",
    url: assertHttpsImage(imageUrl),
  });
  const endpoint = process.env.BHASH_RCS_URL || "https://bhashsms.com/api/sendmsgrcs.php";
  const response = await axios.get(`${endpoint}?${params.toString()}`, {
    timeout: 20000,
    responseType: "text",
    validateStatus: () => true,
  });
  const body = String(response.data || "").trim();
  const ok = response.status >= 200 && response.status < 300 && !/error|fail|invalid/i.test(body);
  return {
    phone: params.get("phone"),
    ok,
    providerResponse: body.slice(0, 300),
  };
}

module.exports = { providerConfig, sendImageTemplate, toProviderPhone };
