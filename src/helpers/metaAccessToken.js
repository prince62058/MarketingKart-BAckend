const axios = require("axios");

const GRAPH = "https://graph.facebook.com/v22.0";

let cachedAppToken = null;
let cachedAppTokenAt = 0;
/** @type {null | true | false} */
let configuredTokenValid = null;
let configuredCheckedAt = 0;

const CONFIG_CHECK_MS = 5 * 60 * 1000;
const APP_TOKEN_TTL_MS = 55 * 60 * 1000;

function getConfiguredMetaToken() {
  return (
    process.env.systemUserAccessToken ||
    process.env.admin_access_token ||
    null
  );
}

function isExpiredMetaError(err) {
  const meta = err?.response?.data?.error || err;
  const msg = String(meta?.message || err?.message || "");
  return (
    meta?.code === 190 ||
    meta?.error_subcode === 463 ||
    /expired|Session has expired/i.test(msg)
  );
}

async function getAppAccessToken() {
  const now = Date.now();
  if (cachedAppToken && now - cachedAppTokenAt < APP_TOKEN_TTL_MS) {
    return cachedAppToken;
  }
  const clientId = process.env.clientId;
  const clientSecret = process.env.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error("clientId/clientSecret missing — cannot mint Meta app token");
  }
  const { data } = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    },
    timeout: 15000,
  });
  if (!data?.access_token) {
    throw new Error("Failed to mint Meta app access token");
  }
  cachedAppToken = data.access_token;
  cachedAppTokenAt = now;
  return cachedAppToken;
}

/** Probe configured system/admin token via Graph /me. */
async function isConfiguredTokenValid(force = false) {
  const token = getConfiguredMetaToken();
  if (!token) {
    configuredTokenValid = false;
    configuredCheckedAt = Date.now();
    return false;
  }
  const now = Date.now();
  if (
    !force &&
    configuredTokenValid !== null &&
    now - configuredCheckedAt < CONFIG_CHECK_MS
  ) {
    return configuredTokenValid;
  }
  try {
    await axios.get(`${GRAPH}/me`, {
      params: { access_token: token, fields: "id" },
      timeout: 10000,
    });
    configuredTokenValid = true;
  } catch (err) {
    // System users sometimes cannot call /me — only treat hard expiry as invalid.
    if (isExpiredMetaError(err)) {
      configuredTokenValid = false;
    } else {
      configuredTokenValid = true;
    }
  }
  configuredCheckedAt = now;
  return configuredTokenValid;
}

/**
 * Token for Meta Marketing write paths (ads create/update).
 * Does NOT fall back to app token — ads need a real system/user token.
 */
function getMetaAccessToken() {
  const token = getConfiguredMetaToken();
  if (!token) {
    throw new Error("systemUserAccessToken is not configured on the server");
  }
  return token;
}

/**
 * Token for Targeting Search (city / state / PIN / interests).
 * Falls back to app access token when the system token is expired/missing —
 * Graph allows client_credentials for type=adgeolocation / adinterest.
 */
async function getMetaSearchToken() {
  const configured = getConfiguredMetaToken();
  if (configured && (await isConfiguredTokenValid(false))) {
    return configured;
  }
  return getAppAccessToken();
}

function invalidateMetaTokenCache() {
  configuredTokenValid = null;
  configuredCheckedAt = 0;
  cachedAppToken = null;
  cachedAppTokenAt = 0;
}

function markConfiguredTokenInvalid() {
  configuredTokenValid = false;
  configuredCheckedAt = Date.now();
}

module.exports = {
  getConfiguredMetaToken,
  getMetaAccessToken,
  getMetaSearchToken,
  getAppAccessToken,
  isConfiguredTokenValid,
  isExpiredMetaError,
  invalidateMetaTokenCache,
  markConfiguredTokenInvalid,
};
