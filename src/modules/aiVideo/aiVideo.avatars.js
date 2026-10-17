// Video ("digital twin") avatars: footage goes from the phone straight to HeyGen storage, HeyGen
// trains a twin from it, and the person in the footage approves it by recording a short consent
// statement on HeyGen's hosted page. Every function takes the loaded studio document.
const Studio = require("./aiVideo.model");
const logic = require("./aiVideo.logic");
const heygen = require("./heygen.client");
const logger = require("../../utils/logger");
const { httpError, providerError, requireProvider } = require("./aiVideo.errors");

const MAX_CUSTOM_AVATARS = 5;
const MIN_FOOTAGE_BYTES = 256 * 1024;
// HeyGen direct upload accepts up to 200 MB of video.
const MAX_FOOTAGE_BYTES = 200 * 1024 * 1024;
const FOOTAGE_TYPES = new Set(["video/mp4", "video/webm"]);
const STALE_UPLOAD_MS = 60 * 60 * 1000;

const STATUS = {
  UPLOADING: "Uploading",
  PROCESSING: "Processing",
  CONSENT: "Consent needed",
  READY: "Ready",
  FAILED: "Failed",
};

// The twin is usable only once HeyGen finished training it AND the person approved it.
function twinStatus(lookStatus, consentStatus) {
  if (lookStatus === "failed") return STATUS.FAILED;
  if (lookStatus === "processing") return STATUS.PROCESSING;
  if (consentStatus === "accepted") return lookStatus === "completed" ? STATUS.READY : STATUS.PROCESSING;
  return STATUS.CONSENT;
}

const FAILURE_COPY = {
  moderation_failed: "This video did not pass content review. Record a new one with only you in frame.",
  training_failed: "We could not train an avatar from this video. Use a clear 1-2 minute clip with your face in frame.",
};

function failureMessage(error) {
  return (error && FAILURE_COPY[error.code]) || (error && error.message) || "The avatar could not be created.";
}

const present = logic.presentAvatar;

function find(studio, avatarId, kind) {
  const avatar = studio.avatars.find(item => item.id === avatarId && item.kind === kind);
  if (!avatar) throw httpError(404, "Avatar not found");
  return avatar;
}

async function patch(studioId, avatarId, fields) {
  const $set = {};
  for (const [key, value] of Object.entries(fields)) $set[`avatars.$.${key}`] = value;
  await Studio.updateOne({ _id: studioId, "avatars.id": avatarId }, { $set });
}

async function chargeOnce(studio, cost) {
  if (!cost) return true;
  const reserved = await Studio.findOneAndUpdate(
    { _id: studio._id, credits: { $gte: cost } },
    { $inc: { credits: -cost } },
    { new: true },
  );
  return Boolean(reserved);
}

// Gives the credits back exactly once, however many pollers race.
async function refundOnce(studioId, avatarId, cost) {
  if (!cost) return;
  await Studio.updateOne(
    { _id: studioId, avatars: { $elemMatch: { id: avatarId, refunded: { $ne: true } } } },
    { $inc: { credits: cost }, $set: { "avatars.$.refunded": true } },
  );
}

// Step 1: reserve an upload slot. The phone then PUTs the video straight to `upload.url`.
async function initVideoAvatar({ studio, input }) {
  requireProvider();
  const name = String(input.name || "My Avatar").trim().slice(0, 40) || "My Avatar";
  const contentType = String(input.contentType || "").toLowerCase();
  const sizeBytes = Number(input.sizeBytes);
  if (!FOOTAGE_TYPES.has(contentType)) {
    throw httpError(400, "Use an MP4 or WebM video. Other formats cannot be trained into an avatar.");
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes < MIN_FOOTAGE_BYTES) {
    throw httpError(400, "That video is too short or empty. Record at least 15 seconds of you talking.");
  }
  if (sizeBytes > MAX_FOOTAGE_BYTES) {
    throw httpError(400, "That video is over 200 MB. Record it at a lower quality or trim it.");
  }

  const now = Date.now();
  const live = studio.avatars.filter(item => item.kind !== "studio");
  const stale = live.filter(
    item => item.status === STATUS.UPLOADING && now - new Date(item.createdAt || 0).getTime() > STALE_UPLOAD_MS,
  );
  if (stale.length) {
    await Studio.updateOne({ _id: studio._id }, { $pull: { avatars: { id: { $in: stale.map(item => item.id) } } } });
  }
  const kept = live.filter(item => !stale.includes(item));
  if (kept.length >= MAX_CUSTOM_AVATARS) {
    throw httpError(400, `You can keep up to ${MAX_CUSTOM_AVATARS} custom avatars. Remove one to add another.`);
  }

  const id = logic.newId();
  let upload;
  try {
    upload = await heygen.createDirectUpload({
      filename: String(input.filename || "footage").slice(0, 120),
      contentType,
      sizeBytes,
      idempotencyKey: `${studio._id}:upload:${id}`,
    });
  } catch (error) {
    throw providerError(error);
  }

  const avatar = {
    id,
    name,
    kind: "clone",
    status: STATUS.UPLOADING,
    format: input.format || "reels",
    voice: "cloned",
    pitch: "natural",
    attire: "blazer",
    background: "studio",
    source: "video",
    heygenAssetId: upload.asset_id,
    sizeBytes,
    contentType,
    uploadExpiresAt: new Date(now + (Number(upload.expires_in_seconds) || 3600) * 1000),
    createdAt: new Date(now),
  };
  await Studio.updateOne({ _id: studio._id }, { $push: { avatars: avatar } });
  return {
    avatar: present(avatar),
    upload: {
      url: upload.upload_url,
      headers: upload.upload_headers || {},
      expiresInSeconds: upload.expires_in_seconds,
      maxBytes: upload.max_bytes,
    },
  };
}

// Step 2: the footage is uploaded, so finalize it and start training the twin.
async function completeVideoAvatar({ studio, avatarId, cost = 0 }) {
  requireProvider();
  const avatar = find(studio, avatarId, "clone");
  if (avatar.status !== STATUS.UPLOADING) {
    throw httpError(400, "This avatar is already being created.");
  }

  try {
    await heygen.completeAsset(avatar.heygenAssetId);
  } catch (error) {
    // Most often the phone never finished the upload; the slot stays open so it can retry.
    throw providerError(error);
  }

  if (!(await chargeOnce(studio, cost))) {
    throw httpError(400, `You need ${cost} credits to create a video avatar.`);
  }

  let created;
  try {
    created = await heygen.createDigitalTwin({
      name: avatar.name,
      assetId: avatar.heygenAssetId,
      idempotencyKey: `${studio._id}:twin:${avatar.id}`,
    });
  } catch (error) {
    const friendly = providerError(error);
    // Nothing was started on the provider, so the charge simply goes back.
    if (cost) await Studio.updateOne({ _id: studio._id }, { $inc: { credits: cost } });
    // Unusable footage will not get better on retry; anything else leaves the slot open to try again.
    if (friendly.status === 400) await patch(studio._id, avatar.id, { status: STATUS.FAILED, error: friendly.message });
    throw friendly;
  }

  const look = created.avatar_item || {};
  const group = created.avatar_group || {};
  const consentStatus = group.consent_status || null;
  const fields = {
    cost,
    heygenLookId: look.id,
    heygenGroupId: group.id,
    defaultVoiceId: look.default_voice_id || group.default_voice_id || null,
    consentStatus,
    previewUrl: look.preview_image_url || group.preview_image_url || null,
    previewVideoUrl: look.preview_video_url || group.preview_video_url || null,
    status: twinStatus(look.status || "processing", consentStatus),
    lastCheckedAt: new Date(),
  };
  await patch(studio._id, avatar.id, fields);
  return { avatar: present({ id: avatar.id, name: avatar.name, kind: avatar.kind, ...fields }) };
}

// Called while the studio loads: pulls training and consent state from the provider.
async function refreshTwin({ studio, avatar }) {
  if (avatar.kind !== "clone" || !avatar.heygenLookId) return false;
  if (avatar.status === STATUS.READY || avatar.status === STATUS.FAILED || avatar.status === STATUS.UPLOADING) return false;
  if (avatar.lastCheckedAt && Date.now() - new Date(avatar.lastCheckedAt).getTime() < logic.POLL_INTERVAL_MS) return false;

  let look;
  let group = null;
  try {
    look = await heygen.getLook(avatar.heygenLookId);
    if (avatar.heygenGroupId) group = await heygen.getAvatarGroup(avatar.heygenGroupId);
  } catch (error) {
    logger.warn(`[AI VIDEO] twin status check failed for ${avatar.id}: ${error.message}`);
    await patch(studio._id, avatar.id, { lastCheckedAt: new Date() });
    return false;
  }

  const consentStatus = (group && group.consent_status) || avatar.consentStatus || null;
  const status = twinStatus(look.status, consentStatus);
  const fields = {
    consentStatus,
    status,
    lastCheckedAt: new Date(),
    previewUrl: look.preview_image_url || avatar.previewUrl || null,
    previewVideoUrl: look.preview_video_url || (group && group.preview_video_url) || avatar.previewVideoUrl || null,
    defaultVoiceId: look.default_voice_id || (group && group.default_voice_id) || avatar.defaultVoiceId || null,
  };
  if (status === STATUS.FAILED) fields.error = failureMessage(look.error);
  else if (status === STATUS.CONSENT && consentStatus === "rejected") {
    fields.error = "The consent video was not accepted. Record it again, facing the camera.";
  } else fields.error = null;

  await patch(studio._id, avatar.id, fields);
  if (status === STATUS.FAILED) await refundOnce(studio._id, avatar.id, avatar.cost);
  return status !== avatar.status || consentStatus !== avatar.consentStatus;
}

// The person in the footage opens this link and records a short statement approving the twin.
async function requestConsent({ studio, avatarId }) {
  requireProvider();
  const avatar = find(studio, avatarId, "clone");
  if (!avatar.heygenGroupId) throw httpError(400, "Upload your video first.");
  if (avatar.status === STATUS.FAILED) throw httpError(400, "This avatar could not be created. Start again with a new video.");
  if (avatar.consentStatus === "accepted") return { consent: "accepted", url: null };
  try {
    const result = await heygen.createConsent(avatar.heygenGroupId, {
      rerouteUrl: process.env.AI_VIDEO_CONSENT_RETURN_URL || undefined,
    });
    const consentStatus = (result.avatar_group && result.avatar_group.consent_status) || "pending";
    await patch(studio._id, avatar.id, { consentStatus, error: null });
    return { consent: consentStatus, url: result.url || null };
  } catch (error) {
    throw providerError(error);
  }
}

// Works for photo and video avatars; the two stock presenters can never be removed.
async function removeAvatar({ studio, avatarId }) {
  const avatar = studio.avatars.find(item => item.id === avatarId);
  if (!avatar || avatar.kind === "studio") throw httpError(404, "Avatar not found");
  if (studio.projects.some(project => project.status === "Rendering" && project.presenter === avatar.id)) {
    throw httpError(400, "A video is still rendering with this avatar. Remove it once that finishes.");
  }
  if (avatar.heygenGroupId && heygen.isConfigured()) {
    try {
      await heygen.deleteAvatarGroup(avatar.heygenGroupId);
    } catch (error) {
      // Already gone on the provider is fine; anything else should not strand the user's list.
      if (!(error instanceof heygen.HeyGenError && error.status === 404)) {
        logger.warn(`[AI VIDEO] could not delete avatar group ${avatar.heygenGroupId}: ${error.message}`);
      }
    }
  }
  await Studio.updateOne({ _id: studio._id }, { $pull: { avatars: { id: avatar.id } } });
  return { deleted: true };
}

module.exports = {
  STATUS,
  MAX_CUSTOM_AVATARS,
  twinStatus,
  present,
  initVideoAvatar,
  completeVideoAvatar,
  refreshTwin,
  requestConsent,
  removeAvatar,
  refundOnce,
};
