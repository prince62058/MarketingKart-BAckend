// WhatsApp Business number settings the panel's "WhatsApp Business" page edits:
//   Profile  — https://developers.facebook.com/docs/whatsapp/cloud-api/reference/business-profiles
//   Commerce — https://developers.facebook.com/docs/whatsapp/cloud-api/reference/commerce-settings
//   Calling  — https://developers.facebook.com/docs/whatsapp/cloud-api/calling/call-settings
const axios = require("axios");
const Account = require("../models/whatsappAccountModel");
const { uploadTemplateHeaderSample } = require("./whatsappCloudApiService");

const BASE_URL = "https://graph.facebook.com/v22.0";
const PROFILE_FIELDS = "about,address,description,email,profile_picture_url,websites,vertical";
const VERTICALS = [
  "UNDEFINED", "OTHER", "AUTO", "BEAUTY", "APPAREL", "EDU", "ENTERTAIN", "EVENT_PLAN", "FINANCE", "GROCERY", "GOVT", "HOTEL",
  "HEALTH", "NONPROFIT", "PROF_SERVICES", "RETAIL", "TRAVEL", "RESTAURANT", "ALCOHOL", "ONLINE_GAMBLING", "PHYSICAL_GAMBLING", "OTC_DRUGS",
];
const LIMITS = { about: 139, address: 256, description: 512, email: 128, website: 256 };

class ProfileError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Checks and trims what the panel sends; only the fields present are returned. */
function cleanProfile(input = {}) {
  const out = {};
  for (const key of ["about", "address", "description", "email"]) {
    if (input[key] === undefined) continue;
    const value = String(input[key] ?? "").trim();
    if (value.length > LIMITS[key]) throw new ProfileError(400, `${key[0].toUpperCase()}${key.slice(1)} can be at most ${LIMITS[key]} characters.`);
    out[key] = value;
  }
  if (out.about !== undefined && !out.about) throw new ProfileError(400, "About can't be empty.");
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new ProfileError(400, "Enter a valid email address.");
  if (input.websites !== undefined) {
    const list = (Array.isArray(input.websites) ? input.websites : []).map((w) => String(w || "").trim()).filter(Boolean);
    if (list.length > 2) throw new ProfileError(400, "Add at most 2 websites.");
    for (const w of list) {
      if (w.length > LIMITS.website || !/^https?:\/\/\S+\.\S+/i.test(w)) throw new ProfileError(400, `“${w}” is not a full website link (start with https://).`);
    }
    out.websites = list;
  }
  if (input.vertical !== undefined) {
    const v = String(input.vertical || "").toUpperCase();
    if (!VERTICALS.includes(v)) throw new ProfileError(400, "Choose a business category from the list.");
    out.vertical = v;
  }
  return out;
}

async function connectedAccount(userId) {
  const account = await Account.findOne({ userId });
  if (!account || account.status !== "CONNECTED" || !account.phoneNumberId || !account.accessToken) {
    throw new ProfileError(409, "Connect your WhatsApp number first.");
  }
  return account;
}

async function graph(method, path, account, { params, data } = {}) {
  try {
    const r = await axios({ method, url: `${BASE_URL}/${path}`, params, data, headers: { Authorization: `Bearer ${account.accessToken}` }, timeout: 20000 });
    return r.data;
  } catch (error) {
    const meta = error?.response?.data?.error;
    throw new ProfileError(error?.response?.status >= 500 ? 502 : 400, meta?.error_user_msg || meta?.message || "WhatsApp did not accept the change. Try again.");
  }
}

async function getProfile(userId) {
  const account = await connectedAccount(userId);
  const r = await graph("get", `${account.phoneNumberId}/whatsapp_business_profile`, account, { params: { fields: PROFILE_FIELDS } });
  const p = r?.data?.[0] || {};
  return {
    about: p.about || "", address: p.address || "", description: p.description || "", email: p.email || "",
    websites: p.websites || [], vertical: p.vertical || "UNDEFINED", profilePictureUrl: p.profile_picture_url || "",
  };
}

async function updateProfile(userId, input) {
  const fields = cleanProfile(input);
  const account = await connectedAccount(userId);
  const data = { messaging_product: "whatsapp", ...fields };
  if (input.profilePictureUrl) {
    try {
      data.profile_picture_handle = await uploadTemplateHeaderSample({ accessToken: account.accessToken, sourceUrl: input.profilePictureUrl });
    } catch (error) {
      throw new ProfileError(400, "Could not use that photo. Upload a square JPG or PNG and try again.");
    }
  }
  if (Object.keys(data).length === 1) throw new ProfileError(400, "Nothing to update.");
  await graph("post", `${account.phoneNumberId}/whatsapp_business_profile`, account, { data });
  return getProfile(userId);
}

async function getCommerce(userId) {
  const account = await connectedAccount(userId);
  const r = await graph("get", `${account.phoneNumberId}/whatsapp_commerce_settings`, account);
  const c = r?.data?.[0] || {};
  return { cartEnabled: Boolean(c.is_cart_enabled), catalogVisible: Boolean(c.is_catalog_visible) };
}

async function updateCommerce(userId, input = {}) {
  const account = await connectedAccount(userId);
  const params = {};
  if (typeof input.cartEnabled === "boolean") params.is_cart_enabled = input.cartEnabled;
  if (typeof input.catalogVisible === "boolean") params.is_catalog_visible = input.catalogVisible;
  if (!Object.keys(params).length) throw new ProfileError(400, "Nothing to update.");
  await graph("post", `${account.phoneNumberId}/whatsapp_commerce_settings`, account, { params });
  return getCommerce(userId);
}

async function getCalling(userId) {
  const account = await connectedAccount(userId);
  const r = await graph("get", `${account.phoneNumberId}/settings`, account);
  const c = r?.calling || {};
  return {
    enabled: c.status === "ENABLED",
    iconVisible: c.call_icon_visibility !== "DISABLE_ALL",
    callbackRequest: c.callback_permission_status === "ENABLED",
  };
}

async function updateCalling(userId, input = {}) {
  const account = await connectedAccount(userId);
  const calling = {};
  if (typeof input.enabled === "boolean") calling.status = input.enabled ? "ENABLED" : "DISABLED";
  if (typeof input.iconVisible === "boolean") calling.call_icon_visibility = input.iconVisible ? "DEFAULT" : "DISABLE_ALL";
  if (typeof input.callbackRequest === "boolean") calling.callback_permission_status = input.callbackRequest ? "ENABLED" : "DISABLED";
  if (!Object.keys(calling).length) throw new ProfileError(400, "Nothing to update.");
  await graph("post", `${account.phoneNumberId}/settings`, account, { data: { calling } });
  return getCalling(userId);
}

module.exports = { VERTICALS, LIMITS, ProfileError, cleanProfile, getProfile, updateProfile, getCommerce, updateCommerce, getCalling, updateCalling };
