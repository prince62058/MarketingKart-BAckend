const ModuleFlags = require("../models/moduleFlagsModel");
const logger = require("../utils/logger");

const MODULES = ["metaAds", "whatsapp", "aiVideo", "rcs", "googleAds"];

const DEFAULT_MESSAGES = Object.freeze({
  metaAds: "Meta Ads is under maintenance. Please try again shortly.",
  whatsapp: "WhatsApp Marketing is under maintenance. Please try again shortly.",
  aiVideo: "AI Video Generation is under maintenance. Please try again shortly.",
  rcs: "RCS Messaging is under maintenance. Please try again shortly.",
  googleAds: "Google Ads is under maintenance. Please try again shortly.",
});

const DEFAULTS = Object.freeze({
  metaAds: true,
  whatsapp: true,
  aiVideo: true,
  rcs: true,
  googleAds: true,
  messages: { ...DEFAULT_MESSAGES },
});

const CACHE_MS = 10 * 1000;
let cache = null;

function merge(stored) {
  const out = {
    metaAds: DEFAULTS.metaAds,
    whatsapp: DEFAULTS.whatsapp,
    aiVideo: DEFAULTS.aiVideo,
    rcs: DEFAULTS.rcs,
    googleAds: DEFAULTS.googleAds,
    messages: { ...DEFAULT_MESSAGES },
  };
  if (!stored) return out;
  for (const key of MODULES) {
    if (typeof stored[key] === "boolean") out[key] = stored[key];
  }
  if (stored.messages && typeof stored.messages === "object") {
    for (const key of MODULES) {
      if (typeof stored.messages[key] === "string" && stored.messages[key].trim()) {
        out.messages[key] = stored.messages[key].trim().slice(0, 280);
      }
    }
  }
  return out;
}

async function get({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const stored = await ModuleFlags.findOne({ key: "global" }).lean();
  const value = merge(stored);
  cache = { at: Date.now(), value };
  return value;
}

function peek() {
  return cache ? cache.value : { ...DEFAULTS, messages: { ...DEFAULT_MESSAGES } };
}

function invalidate() {
  cache = null;
}

function broadcast(flags) {
  if (!global.io) return;
  global.io.emit("module:flags", flags);
  logger.info("module:flags broadcast", {
    metaAds: flags.metaAds,
    whatsapp: flags.whatsapp,
    aiVideo: flags.aiVideo,
    rcs: flags.rcs,
    googleAds: flags.googleAds,
  });
}

async function syncLinkedSettings(flags) {
  // Keep product-specific enabled switches aligned so API guards stay consistent.
  try {
    const rcsSettings = require("./rcsSettingsService");
    await rcsSettings.update({ enabled: Boolean(flags.rcs) }, { name: "module-flags" });
  } catch (error) {
    logger.warn(`Could not sync RCS enabled flag: ${error.message}`);
  }
  try {
    const aiSettings = require("../modules/aiVideo/aiVideo.settings");
    await aiSettings.update({ enabled: Boolean(flags.aiVideo) }, { name: "module-flags" });
  } catch (error) {
    logger.warn(`Could not sync AI Video enabled flag: ${error.message}`);
  }
}

async function update(input, admin) {
  const current = await get({ fresh: true });
  const next = {
    metaAds: current.metaAds,
    whatsapp: current.whatsapp,
    aiVideo: current.aiVideo,
    rcs: current.rcs,
    googleAds: current.googleAds,
    messages: { ...current.messages },
  };

  for (const key of MODULES) {
    if (typeof input?.[key] === "boolean") next[key] = input[key];
  }
  if (input?.messages && typeof input.messages === "object") {
    for (const key of MODULES) {
      if (typeof input.messages[key] === "string") {
        const text = input.messages[key].trim().slice(0, 280);
        next.messages[key] = text || DEFAULT_MESSAGES[key];
      }
    }
  }

  const saved = await ModuleFlags.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        ...next,
        updatedBy: (admin && (admin.name || admin.email)) || "admin",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  invalidate();
  const flags = merge(saved);
  await syncLinkedSettings(flags);
  broadcast(flags);
  return flags;
}

async function setModule(key, enabled, admin) {
  if (!MODULES.includes(key)) {
    const error = new Error(`Unknown module "${key}"`);
    error.status = 400;
    throw error;
  }
  return update({ [key]: Boolean(enabled) }, admin);
}

module.exports = {
  MODULES,
  DEFAULTS,
  DEFAULT_MESSAGES,
  get,
  peek,
  update,
  setModule,
  invalidate,
  broadcast,
};
