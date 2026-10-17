const mongoose = require("mongoose");
const Studio = require("./aiVideo.model");
const User = require("../../models/userModel");
const Transaction = require("../../models/transtionModel");
const logic = require("./aiVideo.logic");
const payments = require("./aiVideo.payments");
const heygen = require("./heygen.client");
const catalog = require("./heygen.catalog");
const scriptWriter = require("./aiVideo.script");
const storage = require("./aiVideo.storage");
const settings = require("./aiVideo.settings");
const avatars = require("./aiVideo.avatars");
const { httpError, providerError, requireProvider } = require("./aiVideo.errors");
const logger = require("../../utils/logger");

const { POLL_INTERVAL_MS, PROVIDER_URL_REFRESH_MS, newId, seedAvatars, presentProject, presentAvatar } = logic;

const FORMATS = new Set(["9:16", "16:9", "1:1", "4:5"]);
const PITCH_SEMITONES = { lower: -3, natural: 0, brighter: 3 };
const AVATAR_VOICES = new Set(["cloned", "priya", "aarav", "kavya"]);
const PAUSED = "AI video is paused for maintenance right now. Please try again a little later.";

// The admin can switch AI video off without a deploy; nothing that spends money should start then.
async function activeSettings() {
  const config = await settings.get();
  if (!config.enabled) throw httpError(503, PAUSED);
  return config;
}

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

async function loadStudio(userId, businessId) {
  const scope = { userId, businessId: businessId || null };
  const insert = { credits: (await settings.get()).freeCredits, plan: "free", projects: [], avatars: seedAvatars() };
  try {
    return await Studio.findOneAndUpdate(scope, { $setOnInsert: insert }, { new: true, upsert: true, setDefaultsOnInsert: true });
  } catch (error) {
    // Two first requests raced on the unique (userId, businessId) index; the loser just reads.
    if (error && error.code === 11000) return Studio.findOne(scope);
    throw error;
  }
}

async function getStudio(userId, businessId) {
  let studio = await loadStudio(userId, businessId);
  const [rendered, paid] = await Promise.all([settleStudio(studio), settleOrders(studio)]);
  if (rendered || paid) studio = await Studio.findById(studio._id);
  return studio;
}

// `config` is what the admin Settings page holds; callers that already loaded it pass it in.
function present(studio, config = settings.peek()) {
  const projects = [...studio.projects]
    .map(project => presentProject(project))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    credits: studio.credits,
    plan: logic.effectivePlan(studio),
    planRenewsAt: studio.planRenewsAt || null,
    goal: studio.goal,
    enabled: config.enabled,
    resolution: config.resolution,
    videoCost: config.videoCost,
    voiceoverCost: config.voiceoverCost,
    avatarCosts: { photo: config.photoAvatarCost, video: config.videoAvatarCost },
    projects,
    avatars: studio.avatars.map(presentAvatar),
    plans: config.plans.filter(plan => plan.active !== false),
    packs: config.packs.filter(pack => pack.active !== false),
  };
}

async function saveGoal(userId, businessId, goal) {
  const studio = await loadStudio(userId, businessId);
  studio.goal = String(goal || "").slice(0, 40);
  await studio.save();
  return present(studio, await settings.get());
}

// ---------------------------------------------------------------------------
// Render tracking
// ---------------------------------------------------------------------------

async function patchProject(studioId, projectId, fields) {
  const $set = {};
  for (const [key, value] of Object.entries(fields)) $set[`projects.$.${key}`] = value;
  await Studio.updateOne({ _id: studioId, "projects.id": projectId }, { $set });
}

// Marks a render failed and returns its credits exactly once, however many pollers race.
async function failProject(studioId, project, reason) {
  const cost = Number.isFinite(project.cost) ? project.cost : logic.VIDEO_COST;
  await Studio.updateOne(
    { _id: studioId, projects: { $elemMatch: { id: project.id, refunded: { $ne: true } } } },
    {
      $inc: { credits: cost },
      $set: {
        "projects.$.status": "Failed",
        "projects.$.refunded": true,
        "projects.$.error": reason,
        "projects.$.progress": 0,
      },
    },
  );
  await patchProject(studioId, project.id, { status: "Failed", error: reason });
  return true;
}

// The video never existed on the provider, so drop the draft entirely and refund.
async function abortProject(studioId, projectId, cost) {
  await Studio.updateOne(
    { _id: studioId, projects: { $elemMatch: { id: projectId, refunded: { $ne: true } } } },
    { $inc: { credits: cost }, $pull: { projects: { id: projectId } } },
  );
}

function storageFolder(studio) {
  return `AI-VIDEO/${studio.userId}`;
}

async function completeProject(studio, project, video) {
  const burnedIn = project.captions && project.captions !== "off";
  const sourceVideo = burnedIn && video.captioned_video_url ? video.captioned_video_url : video.video_url;
  const [videoCopy, thumbCopy] = await Promise.all([
    storage.mirror(sourceVideo, { folder: storageFolder(studio), name: `${project.id}`, fallbackMimetype: "video/mp4" }),
    video.thumbnail_url
      ? storage.mirror(video.thumbnail_url, {
          folder: storageFolder(studio),
          name: `${project.id}_thumb`,
          fallbackMimetype: "image/jpeg",
        })
      : null,
  ]);
  const seconds = Number(video.duration) || project.durationSeconds || logic.scriptSeconds(project.script);
  await patchProject(studio._id, project.id, {
    status: "Completed",
    progress: 100,
    videoUrl: videoCopy || sourceVideo,
    thumbnailUrl: thumbCopy || video.thumbnail_url || null,
    providerUrlAt: videoCopy ? null : new Date(),
    durationSeconds: seconds,
    duration: logic.formatClock(seconds),
    completedAt: new Date(),
    lastCheckedAt: new Date(),
    error: null,
  });
  return true;
}

const settling = new Map();

// Polls the provider for one rendering project. Returns true when the project changed.
function settleProject(studio, project) {
  const key = `${studio._id}:${project.id}`;
  if (settling.has(key)) return settling.get(key);
  const run = doSettle(studio, project).finally(() => settling.delete(key));
  settling.set(key, run);
  return run;
}

async function doSettle(studio, project) {
  const now = Date.now();
  if (logic.isRenderTimedOut(project, now)) {
    return failProject(studio._id, project, "Rendering took too long, so your credits were returned.");
  }
  if (!project.heygenVideoId) return false;
  if (project.lastCheckedAt && now - new Date(project.lastCheckedAt).getTime() < POLL_INTERVAL_MS) return false;

  let video;
  try {
    video = await heygen.getVideo(project.heygenVideoId);
  } catch (error) {
    if (error instanceof heygen.HeyGenError && error.status === 404) {
      return failProject(studio._id, project, "Rendering was cancelled, so your credits were returned.");
    }
    // A provider hiccup must not fail a render that is still running on their side.
    logger.warn(`[AI VIDEO] status check failed for ${project.id}: ${error.message}`);
    await patchProject(studio._id, project.id, { lastCheckedAt: new Date() });
    return false;
  }

  if (video.status === "failed") {
    logger.error(`[AI VIDEO] render ${project.heygenVideoId} failed: ${video.failure_code || "-"} ${video.failure_message || ""}`);
    return failProject(studio._id, project, "We could not generate this video, so your credits were returned.");
  }
  if (video.status === "completed" && video.video_url) return completeProject(studio, project, video);

  await patchProject(studio._id, project.id, { lastCheckedAt: new Date() });
  return false;
}

// A provider-hosted link (storage was down at completion time) expires after 7 days.
async function refreshProviderUrl(studio, project) {
  if (project.status !== "Completed" || !project.providerUrlAt || !project.heygenVideoId) return false;
  if (Date.now() - new Date(project.providerUrlAt).getTime() < PROVIDER_URL_REFRESH_MS) return false;
  try {
    const video = await heygen.getVideo(project.heygenVideoId);
    if (video.status !== "completed" || !video.video_url) return false;
    return completeProject(studio, project, video);
  } catch (error) {
    logger.warn(`[AI VIDEO] link refresh failed for ${project.id}: ${error.message}`);
    return false;
  }
}

async function refreshAvatar(studio, avatar) {
  if (avatar.status !== "Processing" || !avatar.heygenLookId) return false;
  if (avatar.lastCheckedAt && Date.now() - new Date(avatar.lastCheckedAt).getTime() < POLL_INTERVAL_MS) return false;
  const set = { "avatars.$.lastCheckedAt": new Date() };
  let changed = false;
  try {
    const look = await heygen.getLook(avatar.heygenLookId);
    if (look.status === "completed") {
      set["avatars.$.status"] = "Ready";
      set["avatars.$.previewUrl"] = look.preview_image_url || avatar.previewUrl || null;
      changed = true;
    } else if (look.status === "failed") {
      set["avatars.$.status"] = "Failed";
      set["avatars.$.error"] = (look.error && look.error.message) || "Avatar could not be created.";
      changed = true;
      await avatars.refundOnce(studio._id, avatar.id, avatar.cost);
    }
  } catch (error) {
    logger.warn(`[AI VIDEO] avatar status check failed for ${avatar.id}: ${error.message}`);
  }
  await Studio.updateOne({ _id: studio._id, "avatars.id": avatar.id }, { $set: set });
  return changed;
}

async function settleStudio(studio) {
  if (!heygen.isConfigured()) return false;
  const jobs = [];
  for (const project of studio.projects) {
    if (project.status === "Rendering") jobs.push(settleProject(studio, project));
    else if (project.providerUrlAt) jobs.push(refreshProviderUrl(studio, project));
  }
  for (const avatar of studio.avatars) {
    if (avatar.kind === "clone") jobs.push(avatars.refreshTwin({ studio, avatar }));
    else if (avatar.status === "Processing") jobs.push(refreshAvatar(studio, avatar));
  }
  const results = await Promise.all(jobs.map(job => job.catch(() => false)));
  return results.some(Boolean);
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

const scriptHits = new Map();
const SCRIPTS_PER_HOUR = 30;

function throttleScripts(userId) {
  const key = String(userId);
  const now = Date.now();
  const recent = (scriptHits.get(key) || []).filter(at => now - at < 60 * 60 * 1000);
  if (recent.length >= SCRIPTS_PER_HOUR) {
    throw httpError(400, "You have written a lot of scripts in the last hour. Please try again a little later.");
  }
  recent.push(now);
  scriptHits.set(key, recent);
}

async function writeScript(userId, input) {
  throttleScripts(userId);
  const { script, source } = await scriptWriter.write(input);
  return { script, duration: logic.estimateDuration(script), source };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function parseSpeed(value) {
  const speed = parseFloat(String(value || "1"));
  if (!Number.isFinite(speed)) return 1;
  return Math.min(1.5, Math.max(0.5, speed));
}

async function createProject(userId, businessId, input) {
  requireProvider();
  const config = await activeSettings();
  const studio = await loadStudio(userId, businessId);

  let script = String(input.script || "").trim();
  if (!script) script = (await scriptWriter.write(input)).script;
  if (script.length > config.maxScriptChars) {
    throw httpError(400, `Keep the script under ${config.maxScriptChars} characters so the video stays short.`);
  }
  const format = FORMATS.has(input.format) ? input.format : "9:16";
  const language = ["hindi", "hinglish", "english"].includes(input.language) ? input.language : "hinglish";
  const speed = parseSpeed(input.speed);
  const captions = String(input.captions || "bold");
  const captionsOn = captions !== "off";

  if (studio.projects.filter(project => project.status === "Rendering").length >= config.maxConcurrentRenders) {
    throw httpError(400, "You already have videos rendering. Wait for one to finish before starting another.");
  }

  // Read-only lookups first, so nothing is charged when a presenter or voice is unavailable.
  let presenter;
  let voiceId;
  try {
    const custom = studio.avatars.find(avatar => avatar.id === input.presenter && avatar.heygenLookId);
    if (custom && custom.status !== "Ready") {
      throw httpError(400, custom.status === "Consent needed" ? "Finish the consent video for this avatar before using it." : "This avatar is still being created.");
    }
    presenter = await catalog.resolvePresenter(input.presenter === "raj" ? "raj" : "priya", {
      lookId: custom && custom.heygenLookId,
    });
    // A video avatar speaks in the voice cloned from its footage unless a stock voice is picked.
    const ownVoice = input.voice === "cloned" ? (custom && custom.defaultVoiceId) || presenter.defaultVoiceId : null;
    voiceId =
      ownVoice ||
      (await catalog.resolveVoice({
        voice: input.voice === "cloned" ? "priya" : input.voice,
        language,
        fallbackVoiceId: presenter.defaultVoiceId,
      }));
  } catch (error) {
    throw providerError(error);
  }

  const title = String(input.title || input.prompt || "AI Promo Video").trim().slice(0, 48) || "AI Promo Video";
  const projectId = newId();
  // The presenter's saved pitch (set on the Customize screen) shifts the voice by a few semitones.
  const saved = studio.avatars.find(avatar => avatar.id === (input.presenter || "priya"));
  const pitch = PITCH_SEMITONES[(saved && saved.pitch) || "natural"] || 0;
  const project = {
    id: projectId,
    title,
    status: "Rendering",
    format,
    duration: logic.estimateDuration(script),
    durationSeconds: logic.scriptSeconds(script),
    presenter: input.presenter || "priya",
    progress: 3,
    script,
    badgeText: format,
    voice: input.voice || "priya",
    language,
    speed,
    music: input.music || "none",
    captions,
    avatarLookId: presenter.avatarId,
    voiceId,
    cost: config.videoCost,
    renderStartedAt: new Date(),
    createdAt: new Date(),
  };

  // Charge and record in one atomic step, so two quick taps cannot overspend.
  const reserved = await Studio.findOneAndUpdate(
    { _id: studio._id, credits: { $gte: config.videoCost } },
    { $inc: { credits: -config.videoCost }, $push: { projects: project } },
    { new: true },
  );
  if (!reserved) throw httpError(400, `You need ${config.videoCost} credits to render a video.`);

  try {
    const created = await heygen.createVideo(
      {
        type: "avatar",
        avatar_id: presenter.avatarId,
        script,
        voice_id: voiceId,
        title,
        aspect_ratio: format,
        resolution: config.resolution,
        voice_settings: pitch ? { speed, pitch } : { speed },
        caption: captionsOn ? { file_format: "srt", style: "default" } : undefined,
        engine: presenter.engine,
      },
      { idempotencyKey: `${studio._id}:${projectId}` },
    );
    await patchProject(studio._id, projectId, { heygenVideoId: created.video_id, lastCheckedAt: new Date() });
  } catch (error) {
    await abortProject(studio._id, projectId, config.videoCost);
    throw providerError(error);
  }

  const fresh = await Studio.findById(studio._id);
  return { credits: fresh.credits, project: presentProject(fresh.projects.find(item => item.id === projectId)) };
}

async function getProject(userId, businessId, projectId) {
  const studio = await getStudio(userId, businessId);
  const project = studio.projects.find(item => item.id === projectId);
  if (!project) throw httpError(404, "Video not found");
  return { credits: studio.credits, project: presentProject(project) };
}

async function deleteProject(userId, businessId, projectId) {
  const studio = await loadStudio(userId, businessId);
  const project = studio.projects.find(item => item.id === projectId);
  if (!project) throw httpError(404, "Video not found");
  if (project.status === "Rendering") {
    throw httpError(400, "This video is still rendering. You can delete it once it finishes.");
  }
  await Studio.updateOne({ _id: studio._id }, { $pull: { projects: { id: projectId } } });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Voiceovers
// ---------------------------------------------------------------------------

async function createVoiceover(userId, businessId, input) {
  requireProvider();
  const config = await activeSettings();
  const studio = await loadStudio(userId, businessId);
  const script = String(input.script || "").trim();
  if (!script) throw httpError(400, "Write what the voice should say.");
  if (script.length > config.maxScriptChars) {
    throw httpError(400, `Keep the script under ${config.maxScriptChars} characters.`);
  }
  const language = ["hindi", "hinglish", "english"].includes(input.language) ? input.language : "hinglish";

  let voiceId;
  try {
    voiceId = await catalog.resolveVoice({ voice: input.voice, language });
  } catch (error) {
    throw providerError(error);
  }

  const reserved = await Studio.findOneAndUpdate(
    { _id: studio._id, credits: { $gte: config.voiceoverCost } },
    { $inc: { credits: -config.voiceoverCost } },
    { new: true },
  );
  if (!reserved) throw httpError(400, `You need ${config.voiceoverCost} credits for a voiceover.`);

  const id = newId();
  let speech;
  try {
    speech = await heygen.generateSpeech({ text: script, voice_id: voiceId, speed: parseSpeed(input.speed) });
  } catch (error) {
    await Studio.updateOne({ _id: studio._id }, { $inc: { credits: config.voiceoverCost } });
    throw providerError(error);
  }
  const audioUrl =
    (await storage.mirror(speech.audio_url, {
      folder: `${storageFolder(studio)}/voiceovers`,
      name: id,
      fallbackMimetype: "audio/mpeg",
    })) || speech.audio_url;

  const voiceover = {
    id,
    language,
    voice: input.voice || "priya",
    script,
    status: "ready",
    audioUrl,
    durationSeconds: Number(speech.duration) || null,
    cost: config.voiceoverCost,
    createdAt: new Date(),
  };
  const saved = await Studio.findOneAndUpdate({ _id: studio._id }, { $push: { voiceovers: voiceover } }, { new: true });
  return { credits: saved.credits, voiceover };
}

async function listVoices(input) {
  requireProvider();
  const language = ["hindi", "hinglish", "english"].includes(input.language) ? input.language : "hinglish";
  try {
    return { language, voices: await catalog.libraryVoices({ language, gender: input.gender, search: input.search }) };
  } catch (error) {
    throw providerError(error);
  }
}

async function voicePreview(input) {
  requireProvider();
  const language = ["hindi", "hinglish", "english"].includes(input.language) ? input.language : "hinglish";
  try {
    const { name, previewUrl } = await catalog.resolveVoiceDetails({ voice: input.voice, language });
    if (!previewUrl) throw httpError(404, "No sample is available for this voice.");
    return { name, previewUrl };
  } catch (error) {
    throw providerError(error);
  }
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

async function saveAvatar(userId, businessId, input, file) {
  if (!file) throw httpError(400, "Add a clear, front-facing photo to create your avatar.");
  requireProvider();
  const config = await activeSettings();
  const studio = await loadStudio(userId, businessId);
  if (studio.avatars.filter(avatar => avatar.kind !== "studio").length >= avatars.MAX_CUSTOM_AVATARS) {
    throw httpError(400, `You can keep up to ${avatars.MAX_CUSTOM_AVATARS} custom avatars. Remove one to add another.`);
  }
  const name = String(input.name || "My Avatar").trim().slice(0, 40) || "My Avatar";

  const cost = config.photoAvatarCost;
  if (cost) {
    const reserved = await Studio.findOneAndUpdate({ _id: studio._id, credits: { $gte: cost } }, { $inc: { credits: -cost } }, { new: true });
    if (!reserved) throw httpError(400, `You need ${cost} credits to create an avatar.`);
  }

  let look;
  let group;
  try {
    const asset = await heygen.uploadAsset({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
    });
    const created = await heygen.createPhotoAvatar({
      name,
      assetId: asset.asset_id,
      idempotencyKey: `${studio._id}:avatar:${newId()}`,
    });
    look = created.avatar_item;
    group = created.avatar_group;
  } catch (error) {
    if (cost) await Studio.updateOne({ _id: studio._id }, { $inc: { credits: cost } });
    throw providerError(error);
  }

  const avatar = {
    id: newId(),
    name,
    kind: "photo",
    status: look.status === "completed" ? "Ready" : look.status === "failed" ? "Failed" : "Processing",
    format: input.format || "reels",
    voice: "studio",
    pitch: "natural",
    attire: "blazer",
    background: "studio",
    source: "photos",
    heygenLookId: look.id,
    heygenGroupId: group && group.id,
    previewUrl: look.preview_image_url || null,
    error: look.error && look.error.message,
    cost,
    createdAt: new Date(),
  };
  await Studio.updateOne({ _id: studio._id }, { $push: { avatars: avatar } });
  if (avatar.status === "Failed") await avatars.refundOnce(studio._id, avatar.id, cost);
  return { avatar: presentAvatar(avatar) };
}

// ---- Video ("digital twin") avatars: see aiVideo.avatars.js for the flow ----

async function initVideoAvatar(userId, businessId, input = {}) {
  await activeSettings();
  const studio = await loadStudio(userId, businessId);
  return avatars.initVideoAvatar({ studio, input });
}

async function completeVideoAvatar(userId, businessId, avatarId) {
  const config = await activeSettings();
  const studio = await loadStudio(userId, businessId);
  return avatars.completeVideoAvatar({ studio, avatarId, cost: config.videoAvatarCost });
}

async function requestAvatarConsent(userId, businessId, avatarId) {
  const studio = await loadStudio(userId, businessId);
  return avatars.requestConsent({ studio, avatarId });
}

async function removeAvatar(userId, businessId, avatarId) {
  const studio = await loadStudio(userId, businessId);
  return avatars.removeAvatar({ studio, avatarId });
}

async function getAvatar(userId, businessId, avatarId) {
  const studio = await getStudio(userId, businessId);
  const avatar = studio.avatars.find(item => item.id === avatarId);
  if (!avatar) throw httpError(404, "Avatar not found");
  return { avatar: presentAvatar(avatar) };
}

async function updateAvatar(userId, businessId, avatarId, input) {
  const studio = await loadStudio(userId, businessId);
  const avatar = studio.avatars.find(item => item.id === avatarId);
  if (!avatar) throw httpError(404, "Avatar not found");
  // `status` is deliberately not editable: it comes from the provider only. Voice and pitch are
  // the only look settings the video provider can apply, so they are the only ones accepted.
  if (input.name !== undefined) {
    const name = String(input.name).trim().slice(0, 40);
    if (!name) throw httpError(400, "Give the avatar a name.");
    avatar.name = name;
  }
  if (input.voice !== undefined) {
    if (catalog.isLibraryVoice(input.voice)) {
      // A pick from the voice library: check it still exists and remember its name for display.
      try {
        const details = await catalog.resolveVoiceDetails({ voice: input.voice });
        avatar.voice = input.voice;
        avatar.voiceName = details.name || null;
      } catch (error) {
        throw providerError(error);
      }
    } else {
      if (!AVATAR_VOICES.has(input.voice)) throw httpError(400, "Choose one of the available voices.");
      if (input.voice === "cloned" && avatar.kind !== "clone") throw httpError(400, "A cloned voice is only available on video avatars.");
      avatar.voice = input.voice;
      avatar.voiceName = null;
    }
  }
  if (input.pitch !== undefined) {
    if (!(input.pitch in PITCH_SEMITONES)) throw httpError(400, "Pitch must be lower, natural or brighter.");
    avatar.pitch = input.pitch;
  }
  studio.markModified("avatars");
  await studio.save();
  return { avatar: presentAvatar(avatar) };
}

// ---------------------------------------------------------------------------
// Orders & enterprise
// ---------------------------------------------------------------------------

// Credits and plans are granted in exactly one place, grantOrder, and only by an update that
// flips the order's status. Whichever of the app's confirm call, the Razorpay webhook or a
// wallet retry gets there first wins; every later attempt matches nothing and grants nothing.

const DAY_MS = 24 * 60 * 60 * 1000;

function paymentDetails(order) {
  if (order.method === "wallet") return { gateway: "wallet", amount: logic.toPaise(order.price), currency: "INR" };
  return {
    gateway: "razorpay",
    keyId: payments.publicKeyId(),
    orderId: order.razorpayOrderId,
    amount: order.amountPaise,
    currency: "INR",
  };
}

async function createOrder(userId, businessId, input = {}) {
  const purchase = logic.resolvePurchase(input, await settings.get({ fresh: true }));
  if (!purchase) throw httpError(400, "Choose a valid credit pack or plan.");
  const method = input.method === "wallet" ? "wallet" : "razorpay";
  if (method === "razorpay" && !payments.isConfigured()) {
    logger.error("[AI VIDEO] Razorpay keys are not configured; refusing to create an order");
    throw httpError(503, payments.UNAVAILABLE);
  }

  const studio = await loadStudio(userId, businessId);
  const now = Date.now();
  const respond = (order, credits) => ({
    order: logic.presentOrder(order),
    credits,
    granted: false,
    payment: paymentDetails(order),
    message: "Order created. Credits are added as soon as the payment is confirmed.",
  });

  const reusable = studio.orders.find(
    order =>
      order.status === "pending_payment" &&
      order.method === method &&
      order.kind === purchase.kind &&
      order.itemId === purchase.itemId &&
      (order.billing || null) === purchase.billing &&
      order.price === purchase.price &&
      now - new Date(order.createdAt).getTime() < logic.REUSE_ORDER_MS &&
      (method === "wallet" || order.razorpayOrderId),
  );
  if (reusable) return respond(reusable, studio.credits);

  await Studio.updateOne(
    { _id: studio._id },
    { $pull: { orders: { status: "pending_payment", createdAt: { $lt: new Date(now - logic.STALE_ORDER_MS) } } } },
  );
  const open = studio.orders.filter(
    order => order.status === "pending_payment" && now - new Date(order.createdAt).getTime() < logic.STALE_ORDER_MS,
  ).length;
  if (open >= logic.MAX_PENDING_ORDERS) {
    throw httpError(400, "You have too many unpaid orders. Please try again in a little while.");
  }

  const id = newId();
  const amountPaise = logic.toPaise(purchase.price);
  let razorpayOrderId;
  if (method === "razorpay") {
    const created = await payments.createOrder({
      amountPaise,
      receipt: id,
      notes: { order: id, studio: String(studio._id), user: String(userId), item: purchase.itemId },
    });
    if (!created || !created.id || created.amount !== amountPaise) {
      logger.error(`[AI VIDEO] Razorpay returned an unexpected order for ${id}: ${JSON.stringify(created)}`);
      throw httpError(503, payments.UNAVAILABLE);
    }
    razorpayOrderId = created.id;
  }

  const order = {
    id,
    kind: purchase.kind,
    itemId: purchase.itemId,
    billing: purchase.billing,
    price: purchase.price,
    amountPaise,
    credits: purchase.credits,
    termDays: purchase.termDays,
    method,
    status: "pending_payment",
    razorpayOrderId,
    createdAt: new Date(),
  };
  await Studio.updateOne({ _id: studio._id }, { $push: { orders: order } });
  return respond(order, studio.credits);
}

// Flips a pending order to paid and hands over the credits (and plan) in a single update.
// Returns the updated studio, or null when the order was no longer in `fromStatus`.
function grantOrder(studio, order, { fromStatus, paymentId, methodLabel }) {
  const now = new Date();
  const $set = {
    "orders.$.status": "paid",
    "orders.$.paidAt": now,
    "orders.$.methodLabel": methodLabel,
  };
  if (paymentId) $set["orders.$.razorpayPaymentId"] = paymentId;
  if (order.kind === "plan") {
    // Renewing the plan you are already on adds to the time left; switching starts a fresh term.
    const left = studio.plan === order.itemId && studio.planRenewsAt ? new Date(studio.planRenewsAt).getTime() : 0;
    $set.plan = order.itemId;
    $set.planBilling = order.billing;
    $set.planRenewsAt = new Date(Math.max(now.getTime(), left) + order.termDays * DAY_MS);
  }
  return Studio.findOneAndUpdate(
    { _id: studio._id, orders: { $elemMatch: { id: order.id, status: fromStatus } } },
    { $inc: { credits: order.credits }, $set },
    { new: true },
  );
}

function presentPurchase(studio, order, extra = {}) {
  return {
    granted: order.status === "paid",
    credits: studio.credits,
    plan: logic.effectivePlan(studio),
    planRenewsAt: studio.planRenewsAt || null,
    order: logic.presentOrder(order),
    ...extra,
  };
}

// Used by both the app's confirm call and the webhook. It trusts nothing it was sent: the order's
// price comes from our own record, and the payment is re-read from Razorpay before anything is granted.
async function settleRazorpayOrder(studio, order, paymentId) {
  if (order.status === "paid") {
    if (order.razorpayPaymentId === paymentId) return presentPurchase(studio, order, { alreadyProcessed: true });
    throw httpError(409, "This order was already paid with a different payment.");
  }
  if (order.status !== "pending_payment" || order.method !== "razorpay") {
    throw httpError(400, "This order can no longer be paid.");
  }

  let payment = await payments.fetchPayment(paymentId);
  if (!payment || payment.order_id !== order.razorpayOrderId) {
    logger.error(`[AI VIDEO] payment ${paymentId} does not belong to order ${order.razorpayOrderId}`);
    throw httpError(400, "This payment does not belong to this order.");
  }
  if (payment.currency !== "INR" || payment.amount !== order.amountPaise) {
    logger.error(`[AI VIDEO] payment ${paymentId} amount ${payment.amount} ${payment.currency} != order ${order.amountPaise}`);
    throw httpError(400, "The amount paid does not match this order.");
  }
  // Accounts set to manual capture leave a successful payment "authorized" until we take it.
  if (payment.status === "authorized") payment = await payments.capturePayment(paymentId, order.amountPaise);
  if (payment.status !== "captured" || payment.amount_refunded) {
    throw httpError(402, "This payment was not completed. If money was deducted, your bank will return it.");
  }

  const granted = await grantOrder(studio, order, {
    fromStatus: "pending_payment",
    paymentId,
    methodLabel: payments.describeMethod(payment),
  });
  if (granted) return presentPurchase(granted, granted.orders.find(item => item.id === order.id));

  // Lost the race to the other path; report what it did.
  const fresh = await Studio.findById(studio._id);
  const done = fresh.orders.find(item => item.id === order.id);
  if (done && done.status === "paid" && done.razorpayPaymentId === paymentId) {
    return presentPurchase(fresh, done, { alreadyProcessed: true });
  }
  throw httpError(409, "This order was already settled.");
}

async function confirmPayment(userId, input = {}) {
  const orderId = String(input.orderId || "");
  const paymentId = String(input.paymentId || "");
  const signature = String(input.signature || "");
  if (!orderId || !paymentId || !signature) throw httpError(400, "Missing payment verification details.");
  if (!payments.verifySignature({ orderId, paymentId, signature })) throw httpError(400, "Payment verification failed.");

  const studio = await Studio.findOne({ userId, "orders.razorpayOrderId": orderId });
  if (!studio) throw httpError(404, "We could not find this order.");
  const order = studio.orders.find(item => item.razorpayOrderId === orderId);
  return settleRazorpayOrder(studio, order, paymentId);
}

// Razorpay calls this when a payment is captured, which covers a customer whose app died after
// paying. Other products on the same Razorpay account send events too; those are not ours.
async function handleRazorpayWebhook({ rawBody, signature }) {
  if (!payments.webhookConfigured()) {
    logger.error("[AI VIDEO] RAZORPAY_WEBHOOK_SECRET is not set; cannot accept Razorpay webhooks");
    throw httpError(503, "Webhook is not configured.");
  }
  if (!payments.verifyWebhookSignature(rawBody, signature)) throw httpError(400, "Invalid signature.");

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    throw httpError(400, "Invalid payload.");
  }
  const payment = event && event.payload && event.payload.payment && event.payload.payment.entity;
  if (!["payment.captured", "order.paid"].includes(event && event.event) || !payment || !payment.order_id || !payment.id) {
    return { handled: false };
  }
  const studio = await Studio.findOne({ "orders.razorpayOrderId": payment.order_id });
  if (!studio) return { handled: false };

  const order = studio.orders.find(item => item.razorpayOrderId === payment.order_id);
  try {
    await settleRazorpayOrder(studio, order, payment.id);
    return { handled: true };
  } catch (error) {
    // 5xx makes Razorpay retry later; anything else is a definitive "no" that retrying cannot fix.
    if (!error.status || error.status >= 500) throw error;
    logger.warn(`[AI VIDEO] webhook for payment ${payment.id} was not applied: ${error.message}`);
    return { handled: false };
  }
}

// ---- Paying from the MarketingKart wallet ----

// Debits the wallet at most once per order. The debit and its marker are one update, so a retry
// after a crash can tell "already charged" from "not charged yet".
async function debitWalletOnce(userId, order) {
  const before = await User.findOneAndUpdate(
    { _id: userId, wallet: { $gte: order.price }, aiVideoWalletDebits: { $ne: order.id } },
    { $inc: { wallet: -order.price }, $push: { aiVideoWalletDebits: { $each: [order.id], $slice: -200 } } },
    { new: false, projection: { wallet: 1 } },
  );
  if (before) {
    const previousBalance = Number(before.wallet) || 0;
    return { result: "debited", previousBalance, newBalance: parseFloat((previousBalance - order.price).toFixed(2)) };
  }
  if (await User.exists({ _id: userId, aiVideoWalletDebits: order.id })) return { result: "already" };
  return { result: "insufficient" };
}

async function recordWalletDebit(studio, order, balances) {
  try {
    const ledger = {
      type: "DEBIT",
      walletType: "MAIN",
      amount: order.price,
      userId: studio.userId,
      transactionId: `aivideo_${order.id}`,
      description: `AI video: ${order.kind === "plan" ? `${order.itemId} plan` : `${order.credits} credits`}`,
    };
    if (balances) Object.assign(ledger, { previousBalance: balances.previousBalance, newBalance: balances.newBalance });
    if (mongoose.isValidObjectId(studio.businessId)) ledger.businessId = studio.businessId;
    await Transaction.updateOne({ transactionId: ledger.transactionId }, { $setOnInsert: ledger }, { upsert: true });
  } catch (error) {
    logger.error(`[AI VIDEO] could not record wallet debit for order ${order.id}: ${error.message}`);
  }
}

// Takes a claimed (wallet_processing) order the rest of the way: debit once, then grant.
async function finishWalletOrder(studio, order) {
  const debit = await debitWalletOnce(studio.userId, order);
  if (debit.result === "insufficient") {
    await Studio.updateOne(
      { _id: studio._id, orders: { $elemMatch: { id: order.id, status: "wallet_processing" } } },
      { $set: { "orders.$.status": "pending_payment" }, $unset: { "orders.$.claimedAt": "" } },
    );
    throw httpError(400, `Your wallet balance is not enough for ₹${order.price.toLocaleString("en-IN")}. Add money to your wallet or choose another way to pay.`);
  }
  // If this throws, the order stays wallet_processing with the debit marker set, and the next
  // read of the studio finishes the grant without charging again.
  const granted = await grantOrder(studio, order, { fromStatus: "wallet_processing", methodLabel: "Wallet" });
  await recordWalletDebit(studio, order, debit.result === "debited" ? debit : null);
  if (granted) return presentPurchase(granted, granted.orders.find(item => item.id === order.id));
  const fresh = await Studio.findById(studio._id);
  return presentPurchase(fresh, fresh.orders.find(item => item.id === order.id), { alreadyProcessed: true });
}

async function payWithWallet(userId, orderId) {
  const studio = await Studio.findOne({ userId, "orders.id": String(orderId) });
  const order = studio && studio.orders.find(item => item.id === String(orderId));
  if (!order) throw httpError(404, "We could not find this order.");
  if (order.method !== "wallet") throw httpError(400, "This order is paid online, not from the wallet.");
  if (order.status === "paid") return presentPurchase(studio, order, { alreadyProcessed: true });

  if (order.status === "pending_payment") {
    const claimed = await Studio.findOneAndUpdate(
      { _id: studio._id, orders: { $elemMatch: { id: order.id, status: "pending_payment" } } },
      { $set: { "orders.$.status": "wallet_processing", "orders.$.claimedAt": new Date() } },
      { new: true },
    );
    if (!claimed) throw httpError(409, "This order is already being paid.");
    return finishWalletOrder(claimed, claimed.orders.find(item => item.id === order.id));
  }
  // Another tap, or a request that was interrupted, holds the order.
  const stalled = Date.now() - new Date(order.claimedAt || 0).getTime() > logic.WALLET_STALL_MS;
  if (order.status === "wallet_processing" && stalled) return finishWalletOrder(studio, order);
  if (order.status === "wallet_processing") throw httpError(409, "This order is already being paid.");
  throw httpError(400, "This order can no longer be paid.");
}

// Finishes wallet payments that were interrupted part-way, so a customer is never left charged
// without credits.
async function settleOrders(studio) {
  const stuck = studio.orders.filter(
    order =>
      order.status === "wallet_processing" &&
      Date.now() - new Date(order.claimedAt || 0).getTime() > logic.WALLET_STALL_MS,
  );
  const results = await Promise.all(
    stuck.map(order =>
      finishWalletOrder(studio, order).then(
        () => true,
        error => {
          logger.warn(`[AI VIDEO] could not finish wallet order ${order.id}: ${error.message}`);
          return false;
        },
      ),
    ),
  );
  return results.some(Boolean);
}

async function requestEnterprise(userId, businessId, input) {
  const studio = await loadStudio(userId, businessId);
  studio.enterprise = {
    name: String(input.name || "").slice(0, 80),
    phone: String(input.phone || "").slice(0, 20),
    company: String(input.company || "").slice(0, 80),
    status: "requested",
  };
  await studio.save();
  return { request: studio.enterprise };
}

// ---------------------------------------------------------------------------
// Admin diagnostics
// ---------------------------------------------------------------------------

async function providerStatus() {
  if (!heygen.isConfigured()) return { configured: false, ok: false, message: "HEYGEN_API_KEY is not set" };
  try {
    const user = await heygen.getUser();
    const balance = user.wallet && user.wallet.remaining_balance;
    return {
      configured: true,
      ok: true,
      billingType: user.billing_type || null,
      currency: (user.wallet && user.wallet.currency) || null,
      remainingBalance: typeof balance === "number" ? balance : null,
      // A $0 wallet means every render is refused with HTTP 402.
      canRender: !(user.billing_type === "wallet" && !balance),
    };
  } catch (error) {
    return { configured: true, ok: false, message: error.message, status: error.status || null };
  }
}

module.exports = {
  present,
  getStudio,
  saveGoal,
  writeScript,
  createProject,
  getProject,
  deleteProject,
  createVoiceover,
  voicePreview,
  listVoices,
  saveAvatar,
  initVideoAvatar,
  completeVideoAvatar,
  requestAvatarConsent,
  removeAvatar,
  getAvatar,
  updateAvatar,
  createOrder,
  confirmPayment,
  payWithWallet,
  handleRazorpayWebhook,
  requestEnterprise,
  providerStatus,
};
