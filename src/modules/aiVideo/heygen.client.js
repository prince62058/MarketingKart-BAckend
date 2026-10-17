const axios = require("axios");
const FormData = require("form-data");

const DEFAULT_BASE_URL = "https://api.heygen.com";

class HeyGenError extends Error {
  constructor(message, { status = 502, code = "provider_error", requestId = null, param = null } = {}) {
    super(message);
    this.name = "HeyGenError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.param = param;
  }
}

function isConfigured() {
  return Boolean(process.env.HEYGEN_API_KEY);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function http() {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    throw new HeyGenError("AI video provider is not configured", { status: 503, code: "not_configured" });
  }
  return axios.create({
    baseURL: (process.env.HEYGEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    timeout: Number(process.env.HEYGEN_TIMEOUT_MS) || 30000,
    headers: { "X-Api-Key": key, Accept: "application/json" },
    maxBodyLength: 40 * 1024 * 1024,
    validateStatus: () => true,
  });
}

// Never let an axios error escape: its `config.headers` carries the API key.
async function request(method, url, { params, data, headers, retries = method === "get" ? 2 : 0, timeout } = {}) {
  let attempt = 0;
  for (;;) {
    let res;
    try {
      res = await http().request({ method, url, params, data, headers, timeout });
    } catch (error) {
      if (error instanceof HeyGenError) throw error;
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt++);
        continue;
      }
      throw new HeyGenError("Could not reach the video provider", { status: 502, code: "network_error" });
    }
    if (res.status >= 200 && res.status < 300) return res.data;
    if ((res.status >= 500 || res.status === 429) && attempt < retries) {
      await sleep(400 * 2 ** attempt++);
      continue;
    }
    const body = res.data && typeof res.data === "object" ? res.data.error || {} : {};
    throw new HeyGenError(body.message || `Video provider request failed (${res.status})`, {
      status: res.status,
      code: body.code || "provider_error",
      requestId: body.request_id || res.headers?.["x-heygen-request-id"] || null,
      param: body.param || null,
    });
  }
}

const unwrap = body => (body && body.data !== undefined ? body.data : body);

async function getUser() {
  return unwrap(await request("get", "/v3/users/me"));
}

async function getLook(lookId) {
  return unwrap(await request("get", `/v3/avatars/looks/${encodeURIComponent(lookId)}`));
}

async function listLooks(params = {}) {
  const body = await request("get", "/v3/avatars/looks", { params: { limit: 50, ...params } });
  return { items: body.data || [], hasMore: Boolean(body.has_more), nextToken: body.next_token || null };
}

async function listVoices(params = {}) {
  const body = await request("get", "/v3/voices", { params: { limit: 100, ...params } });
  return { items: body.data || [], hasMore: Boolean(body.has_more), nextToken: body.next_token || null };
}

async function getVoice(voiceId) {
  return unwrap(await request("get", `/v3/voices/${encodeURIComponent(voiceId)}`));
}

// Idempotency-Key makes a retried create replay the first response instead of billing twice.
async function createVideo(payload, { idempotencyKey } = {}) {
  const headers = idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : undefined;
  return unwrap(await request("post", "/v3/videos", { data: payload, headers, timeout: 60000 }));
}

async function getVideo(videoId) {
  return unwrap(await request("get", `/v3/videos/${encodeURIComponent(videoId)}`));
}

async function generateSpeech(payload) {
  return unwrap(await request("post", "/v3/voices/speech", { data: payload, timeout: 60000 }));
}

async function uploadAsset({ buffer, filename, mimetype }) {
  const form = new FormData();
  form.append("file", buffer, { filename: filename || "upload", contentType: mimetype });
  return unwrap(
    await request("post", "/v3/assets", {
      data: form,
      headers: form.getHeaders(),
      timeout: 120000,
    }),
  );
}

async function createPhotoAvatar({ name, assetId, idempotencyKey }) {
  const headers = idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : undefined;
  return unwrap(
    await request("post", "/v3/avatars", {
      data: { type: "photo", name, file: { type: "asset_id", asset_id: assetId } },
      headers,
      timeout: 60000,
    }),
  );
}

// Large files (video footage is usually well over the 32 MB proxy limit) go straight to storage:
// the phone PUTs to the presigned url, so the bytes never pass through this server.
async function createDirectUpload({ filename, contentType, sizeBytes, idempotencyKey }) {
  const headers = idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : undefined;
  return unwrap(
    await request("post", "/v3/assets/direct-uploads", {
      data: { filename, content_type: contentType, size_bytes: sizeBytes },
      headers,
    }),
  );
}

async function completeAsset(assetId) {
  return unwrap(await request("post", `/v3/assets/${encodeURIComponent(assetId)}/complete`, { data: {} }));
}

async function createDigitalTwin({ name, assetId, idempotencyKey }) {
  const headers = idempotencyKey ? { "Idempotency-Key": String(idempotencyKey) } : undefined;
  return unwrap(
    await request("post", "/v3/avatars", {
      data: { type: "digital_twin", name, file: { type: "asset_id", asset_id: assetId } },
      headers,
      timeout: 60000,
    }),
  );
}

async function getAvatarGroup(groupId) {
  return unwrap(await request("get", `/v3/avatars/${encodeURIComponent(groupId)}`));
}

// Returns { avatar_group, url }: the url is where the person in the footage records a short
// consent statement on camera. It is valid for 24 hours and takes one submission.
async function createConsent(groupId, { rerouteUrl } = {}) {
  return unwrap(
    await request("post", `/v3/avatars/${encodeURIComponent(groupId)}/consent`, {
      data: rerouteUrl ? { reroute_url: rerouteUrl } : {},
    }),
  );
}

async function deleteAvatarGroup(groupId) {
  return unwrap(await request("delete", `/v3/avatars/${encodeURIComponent(groupId)}`));
}

async function deleteVideo(videoId) {
  return unwrap(await request("delete", `/v3/videos/${encodeURIComponent(videoId)}`));
}

module.exports = {
  HeyGenError,
  isConfigured,
  getUser,
  getLook,
  listLooks,
  listVoices,
  getVoice,
  createVideo,
  getVideo,
  generateSpeech,
  uploadAsset,
  createPhotoAvatar,
  createDirectUpload,
  completeAsset,
  createDigitalTwin,
  getAvatarGroup,
  createConsent,
  deleteAvatarGroup,
  deleteVideo,
};
