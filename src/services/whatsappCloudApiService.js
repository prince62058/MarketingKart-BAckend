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
        fields: "id,name,status,category,language,components",
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
 * Upload a new template to Meta for approval.
 * @param {Object} templateData - { name, category, language, components }
 * @param {Object} credentials - { accessToken, wabaId }
 * @returns {Object} { id, status } from Meta
 */
const uploadTemplateToMeta = async (templateData, credentials) => {
  const { accessToken, wabaId } = credentials || {};
  
  if (!accessToken || !wabaId) {
     throw new Error("Missing WhatsApp credentials (accessToken, wabaId)");
  }

  const url = `${BASE_URL}/${wabaId}/message_templates`;

  // Meta recommends allow_category_change for better approval rates
  const payload = {
    ...templateData,
    allow_category_change: true,
  };

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
  syncTemplatesFromMeta,
  uploadTemplateToMeta,
  fetchPhoneNumbersFromMeta,
};
