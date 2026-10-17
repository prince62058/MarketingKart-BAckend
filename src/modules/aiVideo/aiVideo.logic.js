const crypto = require("crypto");

const VIDEO_COST = 20;
const VOICEOVER_COST = 8;
const FREE_CREDITS = Number(process.env.AI_VIDEO_FREE_CREDITS) || 120;
const MAX_SCRIPT_CHARS = Number(process.env.AI_VIDEO_MAX_SCRIPT_CHARS) || 1200;
const MAX_CONCURRENT_RENDERS = Number(process.env.AI_VIDEO_MAX_CONCURRENT_RENDERS) || 3;
// A render that has not finished by now is treated as lost and refunded.
const RENDER_TIMEOUT_MS = 45 * 60 * 1000;
// Polling HeyGen more often than this per project only burns rate limit.
const POLL_INTERVAL_MS = process.env.AI_VIDEO_POLL_INTERVAL_MS !== undefined ? Number(process.env.AI_VIDEO_POLL_INTERVAL_MS) : 4000;
// HeyGen links expire after 7 days; refresh a provider-hosted link well before that.
const PROVIDER_URL_REFRESH_MS = 5 * 24 * 60 * 60 * 1000;

// Prices are in rupees and are the only source of truth for what a purchase costs. The app
// shows the same numbers, but a client only ever names an item; it never sends an amount.
const PACKS = [
  { id: "pack_100", credits: 100, price: 299 },
  { id: "pack_500", credits: 500, price: 999 },
  { id: "pack_1200", credits: 1200, price: 1999 },
];

// Mirrors the Upgrade screen: Pro is 50 videos a month and Business 200, at 20 credits each.
// Yearly is half the price of twelve months, as the "Save 50%" badge promises.
const PLANS = [
  { id: "free", name: "Free", price: 0, yearlyPrice: 0, monthlyCredits: 120 },
  { id: "pro", name: "Pro", price: 499, yearlyPrice: 2994, monthlyCredits: 1000 },
  { id: "business", name: "Business", price: 1499, yearlyPrice: 8994, monthlyCredits: 4000 },
];

const BILLING_TERMS = {
  monthly: { months: 1, days: 30 },
  yearly: { months: 12, days: 365 },
};

// An unpaid order older than this is dropped, and one younger than REUSE_ORDER_MS is reused,
// so repeated taps on the same pack do not pile up orders.
const STALE_ORDER_MS = 24 * 60 * 60 * 1000;
const REUSE_ORDER_MS = 30 * 60 * 1000;
// A wallet payment that has been in flight this long was interrupted and is finished by the next read.
const WALLET_STALL_MS = 60 * 1000;
const MAX_PENDING_ORDERS = 20;

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

// Turns "which item, which billing" into what it costs and what it grants. Returns null for
// anything that is not on sale (including the free plan).
function resolvePurchase(input, catalog = { packs: PACKS, plans: PLANS }) {
  const kind = input && input.kind === "plan" ? "plan" : "pack";
  if (kind === "plan") {
    const plan = catalog.plans.find(item => item.id === input.planId && item.price > 0 && item.active !== false);
    if (!plan) return null;
    const billing = input.billing === "yearly" ? "yearly" : "monthly";
    const term = BILLING_TERMS[billing];
    return {
      kind,
      itemId: plan.id,
      billing,
      price: billing === "yearly" ? plan.yearlyPrice : plan.price,
      credits: plan.monthlyCredits * term.months,
      termDays: term.days,
      title: `${plan.name} plan (${billing})`,
    };
  }
  const pack = catalog.packs.find(item => item.id === (input && input.packId) && item.active !== false);
  if (!pack) return null;
  return { kind, itemId: pack.id, billing: null, price: pack.price, credits: pack.credits, termDays: 0, title: `${pack.credits} AI video credits` };
}

const toPaise = rupees => Math.round(rupees * 100);

// A plan lapses at the end of the term that was paid for; credits already granted stay.
function effectivePlan(studio, now = Date.now()) {
  if (!studio.plan || studio.plan === "free") return "free";
  if (studio.planRenewsAt && new Date(studio.planRenewsAt).getTime() <= now) return "free";
  return studio.plan;
}

function presentOrder(order) {
  return {
    id: order.id,
    kind: order.kind,
    itemId: order.itemId,
    billing: order.billing || null,
    price: order.price,
    credits: order.credits,
    status: order.status,
    method: order.method || null,
    methodLabel: order.methodLabel || null,
    transactionId: order.status === "paid" ? order.razorpayPaymentId || order.id : null,
    paidAt: order.paidAt || null,
    createdAt: order.createdAt,
  };
}

function scriptSeconds(script) {
  const words = String(script || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(10, Math.round((words / 130) * 60));
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function estimateDuration(script) {
  return formatClock(scriptSeconds(script));
}

// Template fallback used only when the AI writer is unavailable.
function buildScript({ topic, tone, language }) {
  const subject = String(topic || "your offer").trim();
  const lang = language || "hinglish";
  const style = tone || "enthusiastic";
  if (lang === "hindi") {
    return `नमस्ते! ${subject} के लिए यह वीडियो तैयार है। ऑफर साफ है, और आखिर में एक सीधा कदम है। ${style === "urgent" ? "ऑफर सीमित समय के लिए है।" : "आज ही देखें।"}`;
  }
  if (lang === "english") {
    return `Here is the offer: ${subject}. The first seconds state the hook, the middle shows the value, and the close asks the viewer to act now.`;
  }
  return `Hey! ${subject}. Pehle 3 second mein hook, beech mein clear offer, aur end mein seedha call-to-action. ${style === "professional" ? "Tone calm aur business-ready hai." : "Abhi check karein."}`;
}

// HeyGen reports no percentage, so the bar is an estimate that never reaches 100
// until the provider says the file exists.
function estimateProgress(project, now = Date.now()) {
  if (!project) return 0;
  if (project.status === "Completed") return 100;
  if (project.status !== "Rendering" || !project.renderStartedAt) return 0;
  const seconds = Number(project.durationSeconds) || scriptSeconds(project.script);
  const expectedMs = Math.min(8 * 60 * 1000, Math.max(90 * 1000, (60 + seconds * 6) * 1000));
  const elapsed = now - new Date(project.renderStartedAt).getTime();
  return Math.max(3, Math.min(95, Math.floor((elapsed / expectedMs) * 100)));
}

function isRenderTimedOut(project, now = Date.now()) {
  if (!project || project.status !== "Rendering" || !project.renderStartedAt) return false;
  return now - new Date(project.renderStartedAt).getTime() > RENDER_TIMEOUT_MS;
}

function dateLabel(date) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "Just now";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (value >= start) return "Just now";
  return value.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Failed renders surface as "Draft" with an `error`, so existing clients that only know
// Completed / Rendering / Draft keep working.
function presentProject(project, now = Date.now()) {
  const failed = project.status === "Failed";
  return {
    id: project.id,
    title: project.title,
    status: failed ? "Draft" : project.status,
    failed,
    error: failed ? project.error || "Video could not be generated." : null,
    format: project.format,
    duration: project.duration,
    presenter: project.presenter,
    progress: failed ? 0 : estimateProgress(project, now),
    script: project.script || "",
    badgeText: project.badgeText || project.format,
    videoUrl: project.status === "Completed" ? project.videoUrl || null : null,
    thumbnailUrl: project.thumbnailUrl || null,
    dateLabel: dateLabel(project.createdAt),
    createdAt: project.createdAt,
  };
}

function presentAvatar(avatar) {
  const needsConsent = avatar.status === "Consent needed";
  return {
    id: avatar.id,
    name: avatar.name,
    status: avatar.status,
    kind: avatar.kind,
    previewUrl: avatar.previewUrl || null,
    previewVideoUrl: avatar.previewVideoUrl || null,
    consent: avatar.kind === "clone" ? avatar.consentStatus || null : null,
    voice: avatar.voice || null,
    voiceName: avatar.voiceName || null,
    pitch: avatar.pitch || "natural",
    // A rejected consent video is explained on the "Consent needed" state, a failed avatar on "Failed".
    error: avatar.status === "Failed" || needsConsent ? avatar.error || (avatar.status === "Failed" ? "Avatar could not be created." : null) : null,
  };
}

// The two stock presenters every studio starts with.
function seedAvatars() {
  return [
    {
      id: "priya",
      name: "Priya",
      kind: "studio",
      status: "Ready",
      format: "reels",
      voice: "studio",
      pitch: "natural",
      attire: "blazer",
      background: "office",
    },
    {
      id: "raj",
      name: "Raj",
      kind: "studio",
      status: "Ready",
      format: "youtube",
      voice: "studio",
      pitch: "natural",
      attire: "blazer",
      background: "office",
    },
  ];
}

module.exports = {
  VIDEO_COST,
  VOICEOVER_COST,
  FREE_CREDITS,
  MAX_SCRIPT_CHARS,
  MAX_CONCURRENT_RENDERS,
  RENDER_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  PROVIDER_URL_REFRESH_MS,
  PACKS,
  PLANS,
  BILLING_TERMS,
  STALE_ORDER_MS,
  REUSE_ORDER_MS,
  WALLET_STALL_MS,
  MAX_PENDING_ORDERS,
  newId,
  resolvePurchase,
  toPaise,
  effectivePlan,
  presentOrder,
  scriptSeconds,
  formatClock,
  estimateDuration,
  buildScript,
  estimateProgress,
  isRenderTimedOut,
  presentProject,
  presentAvatar,
  seedAvatars,
};
