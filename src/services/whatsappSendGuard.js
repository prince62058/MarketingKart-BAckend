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

// First moment of the current calendar month in India.
function monthStart(now = Date.now()) {
  const ist = new Date(now + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_MS);
}

const monthCounters = new Map(); // phoneNumberId -> { month, count, at }
async function sentThisMonth(phoneNumberId) {
  const month = monthStart().getTime();
  const hit = monthCounters.get(phoneNumberId);
  if (hit && hit.month === month && Date.now() - hit.at < RECOUNT_MS) return hit;
  const count = await Message.countDocuments({ phoneNumberId, direction: "OUTBOUND", createdAt: { $gte: new Date(month) } });
  const entry = { month, count: Math.max(count, hit?.month === month ? hit.count : 0), at: Date.now() };
  monthCounters.set(phoneNumberId, entry);
  if (monthCounters.size > 5000) monthCounters.delete(monthCounters.keys().next().value);
  return entry;
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
  if (!account.phoneNumberId) return;
  const limits = await controls.limitsFor(account.userId);
  const perDay = limits.dailyMessages.value;
  const perMonth = limits.monthlyMessages.value;
  const today = perDay ? await sentToday(account.phoneNumberId) : null;
  const month = perMonth ? await sentThisMonth(account.phoneNumberId) : null;
  if (month && month.count >= perMonth) {
    throw fail(429, "MONTHLY_LIMIT", `Monthly message limit reached (${perMonth.toLocaleString("en-IN")} a month). Ask MarketingKart to raise it.`);
  }
  if (today && today.count >= perDay) {
    throw fail(429, "DAILY_LIMIT", `Daily message limit reached (${perDay.toLocaleString("en-IN")} a day). Sending starts again after midnight.`);
  }
  if (today) today.count += 1;
  if (month) month.count += 1;
}

function reset() { counters.clear(); monthCounters.clear(); }

module.exports = { assertCanSend, sentToday, sentThisMonth, dayStart, monthStart, reset };
