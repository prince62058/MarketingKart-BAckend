const { assertUniquePhone } = require('./whatsappAccountIsolation');
const axios = require("axios");

const GRAPH_API_VERSION = "v22.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Send a WhatsApp template message to a single recipient.
 * @param {string} to - Phone number in E.164 format (e.g. "919876543210")
 * @param {string} templateName - Approved template name (lowercase_underscore)
 * @param {string} languageCode - e.g. "en_US"
 * @param {Array} components - Template component parameters (header, body, buttons)
 * @param {Object} credentials - { accessToken, phoneNumberId } from User's Account
 * @returns {Object} Meta API response { messages: [{ id: 'wamid.xxx' }] }
 */
const sendTemplateMessage = async (to, templateName, languageCode, components, credentials) => {
  await assertUniquePhone(credentials?.phoneNumberId);
  const { accessToken, phoneNumberId } = credentials || {};
  
  if (!accessToken || !phoneNumberId) {
     throw new Error("Missing WhatsApp credentials (accessToken, phoneNumberId)");
  }

  const url = `${BASE_URL}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode || "en_US" },
      components: components || [],
    },
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    const metaError = error?.response?.data?.error;
    const structured = new Error(metaError?.message || error.message || "Meta API error");
    structured.code = metaError?.code || error?.code || "UNKNOWN";
    structured.response = error.response;
    throw structured;
  }
};

/**
 * Send a free-form WhatsApp text message.
 * Note: Subject to Meta's 24-hour customer service window rule.
 * @param {string} to - Phone number in E.164 format
 * @param {string} body - Text content
 * @param {Object} credentials - { accessToken, phoneNumberId } from User's Account
 * @returns {Object} Meta API response
 */
const sendTextMessage = async (to, body, credentials) => {
  await assertUniquePhone(credentials?.phoneNumberId);
  const { accessToken, phoneNumberId } = credentials || {};
  
  if (!accessToken || !phoneNumberId) {
     throw new Error("Missing WhatsApp credentials (accessToken, phoneNumberId)");
  }

  const url = `${BASE_URL}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    const metaError = error?.response?.data?.error;
    const structured = new Error(metaError?.message || error.message || "Meta API error");
    structured.code = metaError?.code || error?.code || "UNKNOWN";
    structured.response = error.response;
    throw structured;
  }
};

/**
 * Send an interactive message (e.g. a WhatsApp Flow form) inside the 24-hour window.
 * @param {string} to - Phone number in E.164 format
 * @param {Object} interactive - The `interactive` object, e.g. { type: "flow", body, action }
 * @param {Object} credentials - { accessToken, phoneNumberId } from User's Account
 * @returns {Object} Meta API response
 */
const sendInteractiveMessage = async (to, interactive, credentials) => {
  await assertUniquePhone(credentials?.phoneNumberId);
  const { accessToken, phoneNumberId } = credentials || {};

  if (!accessToken || !phoneNumberId) {
    throw new Error("Missing WhatsApp credentials (accessToken, phoneNumberId)");
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive,
  };

  try {
    const response = await axios.post(`${BASE_URL}/${phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    const metaError = error?.response?.data?.error;
    const structured = new Error(metaError?.message || error.message || "Meta API error");
    structured.code = metaError?.code || error?.code || "UNKNOWN";
    structured.response = error.response;
    throw structured;
  }
};

/**
 * Send a WhatsApp media message (image, video, document, audio).
 * @param {string} to - Recipient phone number in E.164 format
 * @param {string} mediaType - 'image' | 'video' | 'document' | 'audio'
 * @param {string} mediaUrl - Public URL of the media
 * @param {string} [caption] - Optional text caption
 * @param {Object} credentials - { accessToken, phoneNumberId }
 * @param {string} [filename] - Optional filename for documents
 * @returns {Object} Meta response
 */
const sendMediaMessage = async (to, mediaType, mediaUrl, caption, credentials, filename) => {
  await assertUniquePhone(credentials?.phoneNumberId);
  const { accessToken, phoneNumberId } = credentials || {};

  if (!accessToken || !phoneNumberId) {
    throw new Error("Missing WhatsApp credentials (accessToken, phoneNumberId)");
  }

  const rawType = String(mediaType || "image").toLowerCase();
  const validTypes = ["image", "video", "document", "audio"];
  const type = validTypes.includes(rawType) ? rawType : "image";

  const url = `${BASE_URL}/${phoneNumberId}/messages`;

  const mediaPayload = { link: mediaUrl };
  if (caption && (type === "image" || type === "video" || type === "document")) {
    mediaPayload.caption = caption;
  }
  if (type === "document" && filename) {
    mediaPayload.filename = filename;
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type,
    [type]: mediaPayload,
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });
    return response.data;
  } catch (error) {
    const metaError = error?.response?.data?.error;
    const structured = new Error(metaError?.message || error.message || "Meta API error");
    structured.code = metaError?.code || error?.code || "UNKNOWN";
    structured.response = error.response;
    throw structured;
  }
};

/**
 * Fetch all message templates from Meta WABA.
 * Used for syncing approved/rejected status into local DB.
 * @param {Object} credentials - { accessToken, wabaId }
 * @returns {Array} Array of template objects from Meta
 */
const syncTemplatesFromMeta = async (credentials) => {
  const { accessToken, wabaId } = credentials || {};
  
  if (!accessToken || !wabaId) {
     throw new Error("Missing WhatsApp credentials (accessToken, wabaId)");
  }

  const url = `${BASE_URL}/${wabaId}/message_templates`;

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        fields: "id,name,status,category,language,rejected_reason,components",
        limit: 100,
      },
      timeout: 15000,
    });
    return response.data?.data || [];
  } catch (error) {
    const metaError = error?.response?.data?.error;
    const structured = new Error(metaError?.message || error.message || "Failed to fetch templates from Meta");
    structured.code = metaError?.code || error?.code || "UNKNOWN";
    throw structured;
  }
};

/**
 * Turn a public header photo, video, or PDF into the sample handle WhatsApp
 * requires on a template. A normal link is not a sample, and Meta rejects the
 * template with "IMAGE header needs an example".
 * @param {Object} input - { accessToken, sourceUrl }
 * @returns {Promise<string>} header handle
 */
const uploadTemplateHeaderSample = async ({ accessToken, sourceUrl }) => {
  const appId = process.env.clientId;
  if (!accessToken || !appId) {
    throw new Error("WhatsApp is not ready to upload a template photo.");
  }
  if (!/^https:\/\//i.test(String(sourceUrl || ""))) {
    throw new Error("Upload the header photo first, then submit the template.");
  }

  let file;
  try {
    file = await axios.get(sourceUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 16 * 1024 * 1024,
      maxBodyLength: 16 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error("Could not read the header photo. Upload it again and retry.");
  }

  const bytes = Buffer.from(file.data || []);
  if (!bytes.length) {
    throw new Error("The header photo was empty. Choose another file.");
  }

  let mime = String(file.headers?.["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (bytes.slice(0, 8).toString("hex").startsWith("89504e470d0a1a0a")) mime = "image/png";
  else if (bytes.slice(0, 3).toString("hex") === "ffd8ff") mime = "image/jpeg";
  else if (bytes.slice(0, 4).toString() === "%PDF") mime = "application/pdf";
  else if (bytes.slice(4, 8).toString() === "ftyp") {
    mime = bytes.slice(8, 12).toString().startsWith("3gp") ? "video/3gpp" : "video/mp4";
  }
  else if (!mime || mime === "application/octet-stream") mime = "image/jpeg";

  const allowed = ["image/jpeg", "image/png", "video/mp4", "video/3gpp", "application/pdf"];
  if (!allowed.includes(mime)) {
    throw new Error("Use a JPG, PNG, MP4, or PDF for the template header.");
  }
  const maxBytes = mime.startsWith("image/") ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new Error(mime.startsWith("image/") ? "The header photo must be under 5 MB." : "The header file must be under 16 MB.");
  }

  const rawName = String(sourceUrl).split("/").pop()?.split("?")[0] || "header";
  const fileName = rawName.replace(/[^a-zA-Z0-9._-]/g, "") || "header.jpg";

  let sessionId;
  try {
    const session = await axios.post(`${BASE_URL}/${appId}/uploads`, null, {
      params: { file_name: fileName, file_length: bytes.length, file_type: mime },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20000,
    });
    sessionId = session.data?.id;
  } catch (error) {
    const metaError = error?.response?.data?.error;
    throw new Error(metaError?.error_user_msg || metaError?.message || "WhatsApp could not start the photo upload.");
  }
  if (!sessionId) {
    throw new Error("WhatsApp could not start the photo upload.");
  }

  try {
    const uploaded = await axios.post(`${BASE_URL}/${sessionId}`, bytes, {
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 60000,
    });
    const handle = uploaded.data?.h;
    if (!handle) throw new Error("WhatsApp did not accept the header photo.");
    return handle;
  } catch (error) {
    if (error.message === "WhatsApp did not accept the header photo.") throw error;
    const metaError = error?.response?.data?.error;
    throw new Error(metaError?.error_user_msg || metaError?.message || "WhatsApp did not accept the header photo.");
  }
};

/**
 * Upload a new template to Meta for approval.
 * @param {Object} templateData - { name, category, language, components }
 * @param {Object} credentials - { accessToken, wabaId }
 * @returns {Object} { id, status } from Meta
 */

/** Our copy of a template keeps private `_keys` (media links, location) for sending; Meta must not see them. */
const stripPrivateKeys = (value) => {
  if (Array.isArray(value)) return value.map(stripPrivateKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("_")).map(([key, v]) => [key, stripPrivateKeys(v)]));
  }
  return value;
};

/**
 * Copies the components for Meta: strips private keys and swaps any https link left in an
 * `example.header_handle` (carousel cards, or a header not swapped yet) for a WhatsApp upload handle.
 */
const prepareComponentsForMeta = async (components, accessToken, upload = uploadTemplateHeaderSample) => {
  const copy = stripPrivateKeys(Array.isArray(components) ? components : []);
  const walk = async (node) => {
    if (Array.isArray(node)) { for (const item of node) await walk(item); return; }
    if (!node || typeof node !== "object") return;
    const handles = node.example?.header_handle;
    if (Array.isArray(handles)) {
      node.example.header_handle = await Promise.all(handles.map((h) => (/^https:\/\//i.test(String(h || "")) ? upload({ accessToken, sourceUrl: h }) : h)));
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") await walk(value);
  };
  await walk(copy);
  return copy;
};

const uploadTemplateToMeta = async (templateData, credentials) => {
  const { accessToken, wabaId } = credentials || {};
  
  if (!accessToken || !wabaId) {
     throw new Error("Missing WhatsApp credentials (accessToken, wabaId)");
  }

  const url = `${BASE_URL}/${wabaId}/message_templates`;

  const components = await prepareComponentsForMeta(templateData.components, accessToken);
  const kinds = JSON.stringify(components);
  // A photo, video or file must stay in Marketing. WhatsApp rejects that file if it moves the template to Utility.
  // Carousels and Limited-Time Offers only exist in Marketing, so they never move either.
  const pinned = /"type":"(carousel|limited_time_offer)"/i.test(kinds);
  const payload = {
    name: templateData.name,
    category: templateData.category,
    language: templateData.language,
    components,
    allow_category_change: templateData.allow_category_change !== false && !pinned,
  };
  if (/_text_named_params/.test(kinds)) payload.parameter_format = "NAMED";

  console.log("[Meta API] Submitting template payload:", JSON.stringify(payload, null, 2));

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
    console.log("[Meta API] Template submission success:", JSON.stringify(response.data));
    return response.data;
  } catch (error) {
    const metaError = error?.response?.data?.error;
    console.error("[Meta API] Template submission FAILED:", JSON.stringify({
      message: metaError?.message,
      type: metaError?.type,
      code: metaError?.code,
      error_subcode: metaError?.error_subcode,
      fbtrace_id: metaError?.fbtrace_id,
      error_user_title: metaError?.error_user_title,
      error_user_msg: metaError?.error_user_msg,
      fullPayload: payload,
    }, null, 2));
    const structured = new Error(metaError?.error_user_msg || metaError?.message || error.message || "Failed to upload template to Meta");
    structured.code = metaError?.code || error?.code || "UNKNOWN";
    structured.metaErrorDetails = metaError || null;
    throw structured;
  }
};

/**
 * Fetch phone numbers attached to a WABA.
 * Used during account connection to validate / auto-select a usable phone number.
 * @param {Object} credentials - { accessToken, wabaId }
 * @returns {Array} Array of phone number objects from Meta
 */
const fetchPhoneNumbersFromMeta = async (credentials) => {
  const { accessToken, wabaId } = credentials || {};

  if (!accessToken || !wabaId) {
    throw new Error("Missing WhatsApp credentials (accessToken, wabaId)");
  }

  const url = `${BASE_URL}/${wabaId}/phone_numbers`;

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        fields:
          "id,display_phone_number,verified_name,quality_rating,code_verification_status,status,name_status",
        limit: 100,
      },
      timeout: 15000,
    });
    return response.data?.data || [];
  } catch (error) {
    const metaError = error?.response?.data?.error;
    const structured = new Error(
      metaError?.message || error.message || "Failed to fetch phone numbers from Meta"
    );
    structured.code = metaError?.code || error?.code || "UNKNOWN";
    throw structured;
  }
};

module.exports = {
  sendTemplateMessage,
  sendTextMessage,
  sendInteractiveMessage,
  sendMediaMessage,
  syncTemplatesFromMeta,
  uploadTemplateToMeta,
  uploadTemplateHeaderSample,
  fetchPhoneNumbersFromMeta,
  prepareComponentsForMeta,
  stripPrivateKeys,
};
