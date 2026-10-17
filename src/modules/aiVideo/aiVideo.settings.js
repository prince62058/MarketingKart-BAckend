const logic = require("./aiVideo.logic");
const { Settings, Audit } = require("./aiVideo.settings.model");
const { httpError } = require("./aiVideo.errors");

const CACHE_MS = 15 * 1000;
const RESOLUTIONS = ["720p", "1080p"];
const ID_PATTERN = /^[a-z0-9_]{2,24}$/;

let cache = null;

function defaults() {
  return {
    enabled: true,
    videoCost: logic.VIDEO_COST,
    voiceoverCost: logic.VOICEOVER_COST,
    photoAvatarCost: 0,
    videoAvatarCost: 0,
    freeCredits: logic.FREE_CREDITS,
    maxScriptChars: logic.MAX_SCRIPT_CHARS,
    maxConcurrentRenders: logic.MAX_CONCURRENT_RENDERS,
    resolution: process.env.HEYGEN_RESOLUTION || "1080p",
    packs: logic.PACKS.map(pack => ({ ...pack, active: true })),
    plans: logic.PLANS.map(plan => ({ ...plan, active: true })),
    presenters: { priya: "", raj: "" },
  };
}

const SCALARS = ["enabled", "videoCost", "voiceoverCost", "photoAvatarCost", "videoAvatarCost", "freeCredits", "maxScriptChars", "maxConcurrentRenders", "resolution"];

function merge(stored) {
  const base = defaults();
  if (!stored) return base;
  for (const key of SCALARS) if (stored[key] !== undefined && stored[key] !== null) base[key] = stored[key];
  if (Array.isArray(stored.packs) && stored.packs.length) base.packs = stored.packs.map(pack => ({ id: pack.id, credits: pack.credits, price: pack.price, active: pack.active !== false }));
  if (Array.isArray(stored.plans) && stored.plans.length) {
    base.plans = stored.plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      price: plan.price,
      yearlyPrice: plan.yearlyPrice,
      monthlyCredits: plan.monthlyCredits,
      active: plan.active !== false,
    }));
  }
  if (stored.presenters) base.presenters = { priya: stored.presenters.priya || "", raj: stored.presenters.raj || "" };
  return base;
}

// Read on every request path that spends or charges, so keep it cheap: a short in-memory cache.
async function get({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const stored = await Settings.findOne({ key: "global" }).lean();
  const value = merge(stored);
  cache = { at: Date.now(), value };
  return value;
}

// For synchronous callers: the last loaded value, or the shipped defaults before anything loaded.
function peek() {
  return cache ? cache.value : defaults();
}

function invalidate() {
  cache = null;
}

const int = (value, label, min, max) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw httpError(400, `${label} must be a whole number between ${min} and ${max}.`);
  }
  return number;
};

function validatePacks(packs) {
  if (!Array.isArray(packs) || packs.length < 1 || packs.length > 8) throw httpError(400, "Add between 1 and 8 credit packs.");
  const seen = new Set();
  return packs.map(pack => {
    const id = String(pack && pack.id || "").trim();
    if (!ID_PATTERN.test(id)) throw httpError(400, "Each pack needs an id of lowercase letters, numbers or underscores, like pack_100.");
    if (seen.has(id)) throw httpError(400, `Pack id "${id}" is used twice.`);
    seen.add(id);
    return {
      id,
      credits: int(pack.credits, `Credits for ${id}`, 1, 100000),
      price: int(pack.price, `Price for ${id}`, 1, 1000000),
      active: pack.active !== false,
    };
  });
}

function validatePlans(plans) {
  if (!Array.isArray(plans) || plans.length < 1 || plans.length > 8) throw httpError(400, "Add between 1 and 8 plans.");
  const seen = new Set();
  const out = plans.map(plan => {
    const id = String(plan && plan.id || "").trim();
    if (!ID_PATTERN.test(id)) throw httpError(400, "Each plan needs an id of lowercase letters, numbers or underscores, like pro.");
    if (seen.has(id)) throw httpError(400, `Plan id "${id}" is used twice.`);
    seen.add(id);
    const name = String(plan.name || "").trim().slice(0, 40);
    if (!name) throw httpError(400, `Plan "${id}" needs a name.`);
    const free = id === "free";
    return {
      id,
      name,
      price: free ? 0 : int(plan.price, `Monthly price for ${name}`, 1, 1000000),
      yearlyPrice: free ? 0 : int(plan.yearlyPrice, `Yearly price for ${name}`, 1, 10000000),
      monthlyCredits: int(plan.monthlyCredits, `Monthly credits for ${name}`, 0, 1000000),
      active: free ? true : plan.active !== false,
    };
  });
  if (!seen.has("free")) throw httpError(400, 'Keep the "free" plan: new studios start on it.');
  return out;
}

// Turns a loose admin form into a safe patch. Unknown keys are ignored; known ones are range-checked.
function validatePatch(input) {
  const patch = {};
  if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
  if (input.videoCost !== undefined) patch.videoCost = int(input.videoCost, "Video cost", 1, 1000);
  if (input.voiceoverCost !== undefined) patch.voiceoverCost = int(input.voiceoverCost, "Voiceover cost", 0, 1000);
  if (input.photoAvatarCost !== undefined) patch.photoAvatarCost = int(input.photoAvatarCost, "Photo avatar cost", 0, 5000);
  if (input.videoAvatarCost !== undefined) patch.videoAvatarCost = int(input.videoAvatarCost, "Video avatar cost", 0, 5000);
  if (input.freeCredits !== undefined) patch.freeCredits = int(input.freeCredits, "Free credits for new users", 0, 10000);
  if (input.maxScriptChars !== undefined) patch.maxScriptChars = int(input.maxScriptChars, "Script length limit", 200, 5000);
  if (input.maxConcurrentRenders !== undefined) patch.maxConcurrentRenders = int(input.maxConcurrentRenders, "Videos rendering at once", 1, 10);
  if (input.resolution !== undefined) {
    if (!RESOLUTIONS.includes(input.resolution)) throw httpError(400, `Resolution must be one of ${RESOLUTIONS.join(", ")}.`);
    patch.resolution = input.resolution;
  }
  if (input.packs !== undefined) patch.packs = validatePacks(input.packs);
  if (input.plans !== undefined) patch.plans = validatePlans(input.plans);
  if (input.presenters !== undefined) {
    const clean = value => String(value || "").trim().slice(0, 80);
    patch.presenters = { priya: clean(input.presenters && input.presenters.priya), raj: clean(input.presenters && input.presenters.raj) };
  }
  if (!Object.keys(patch).length) throw httpError(400, "Nothing to change.");
  return patch;
}

async function recordAudit(admin, action, { studioId, userId, summary, data } = {}) {
  await Audit.create({
    adminId: admin && admin._id ? String(admin._id) : null,
    adminName: (admin && (admin.name || admin.email)) || null,
    action,
    studioId: studioId ? String(studioId) : undefined,
    userId: userId ? String(userId) : undefined,
    summary,
    data,
  });
}

async function update(input, admin) {
  const patch = validatePatch(input || {});
  const before = await get({ fresh: true });
  await Settings.findOneAndUpdate(
    { key: "global" },
    { $set: { ...patch, updatedBy: admin && admin._id ? String(admin._id) : null }, $setOnInsert: { key: "global" } },
    { upsert: true, new: true },
  );
  invalidate();
  const after = await get({ fresh: true });
  const changed = Object.keys(patch).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (changed.length) {
    await recordAudit(admin, "settings.update", {
      summary: `Changed ${changed.join(", ")}`,
      data: Object.fromEntries(changed.map(key => [key, { from: before[key], to: after[key] }])),
    });
  }
  return after;
}

module.exports = { defaults, get, peek, update, invalidate, validatePatch, recordAudit, Settings, Audit };
