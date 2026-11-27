// Last check before any message leaves a customer's WhatsApp number (campaigns, inbox, API,
// chatbot, integrations all send through whatsappCloudApiService). Refuses when a super admin
// blocked the number or suspended the customer, or when the day's message limit is used up.
const Message = require("../models/whatsappMessageModel");
const controls = require("./whatsappControls");

const IST_MS = 330 * 60 * 1000;
const RECOUNT_MS = 60 * 1000;
const counters = new Map(); // phoneNumberId -> { day, count, at }

function fail(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

// Midnight in India, as a Date, for the day `now` falls on.
function dayStart(now = Date.now()) {
  return new Date(Math.floor((now + IST_MS) / 86400000) * 86400000 - IST_MS);
}

async function sentToday(phoneNumberId) {
  const day = dayStart().getTime();
  const hit = counters.get(phoneNumberId);
  if (hit && hit.day === day && Date.now() - hit.at < RECOUNT_MS) return hit;
  const count = await Message.countDocuments({ phoneNumberId, direction: "OUTBOUND", createdAt: { $gte: new Date(day) } });
  const entry = { day, count: Math.max(count, hit?.day === day ? hit.count : 0), at: Date.now() };
  counters.set(phoneNumberId, entry);
  if (counters.size > 5000) counters.delete(counters.keys().next().value);
  return entry;
}

async function assertCanSend(account) {
  if (!account?.userId) return;
  const control = await controls.getControl(account.userId);
  if (control.numberBlocked) {
    throw fail(423, "NUMBER_BLOCKED", `This WhatsApp number is blocked by MarketingKart${control.numberBlockReason ? `: ${control.numberBlockReason}` : "."}`);
  }
  if (control.suspended) {
    throw fail(423, "ACCOUNT_SUSPENDED", control.suspendReason || "This WhatsApp account is suspended. Contact support.");
  }
  const limit = (await controls.limitsFor(account.userId)).dailyMessages.value;
  if (!limit || !account.phoneNumberId) return;
  const today = await sentToday(account.phoneNumberId);
  if (today.count >= limit) {
    throw fail(429, "DAILY_LIMIT", `Daily message limit reached (${limit.toLocaleString("en-IN")} a day). Sending starts again after midnight.`);
  }
  today.count += 1;
}

function reset() { counters.clear(); }

module.exports = { assertCanSend, sentToday, dayStart, reset };
