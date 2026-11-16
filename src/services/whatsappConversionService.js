const axios = require("axios");
const Conversation = require("../models/whatsappConversationModel");
const Business = require("../models/businessModel");
const Account = require("../models/whatsappAccountModel");
const ConversionEvent = require("../models/whatsappConversionEventModel");

// Conversions API for Business Messaging (WhatsApp). When a chat that started from a
// Click-to-WhatsApp ad turns into a lead or a sale, the business owner marks it in the app and we
// report it to the WABA's dataset, so Meta can measure and optimise the ad on real outcomes.
// https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging

const EVENTS = { lead: "LeadSubmitted", purchase: "Purchase" };
const CURRENCY = "INR";
const MAX_VALUE = 1e9;
// A send that has not finished after this long (process crash, lost response) may be taken over.
const LOCK_MS = 10 * 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const GRAPH_ID = /^\d+$/;

const graphBase = () => `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || "v22.0"}`;
const graphHeaders = (token) => ({ Authorization: `Bearer ${token}` });

const graph = {
  get: async (path, token) =>
    (await axios.get(`${graphBase()}${path}`, { headers: graphHeaders(token), timeout: 15000 })).data,
  post: async (path, body, token) =>
    (await axios.post(`${graphBase()}${path}`, body, { headers: graphHeaders(token), timeout: 15000 })).data,
};

const defaultDeps = {
  Conversation,
  Business,
  Account,
  ConversionEvent,
  graph,
  now: () => new Date(),
  config: () => ({
    // Only set these when Meta has assigned a partner agent name, or while checking events in the
    // Events Manager "Test events" tab. Test events still count, so nothing is lost if one is left on.
    partnerAgent: process.env.META_CAPI_PARTNER_AGENT || "",
    testEventCode: process.env.META_CAPI_TEST_EVENT_CODE || "",
  }),
};

const fail = (status, code, message, extra = {}) => ({ status, body: { success: false, code, message, ...extra } });
const ok = (status, message, data, extra = {}) => ({ status, body: { success: true, message, data, ...extra } });
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);
const text = (value, max) => {
  if (typeof value === "number") value = String(value);
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
};
const defined = (object) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));

// The referral block Meta adds to an inbound message sent from a Click-to-WhatsApp ad.
// Ads shown in WhatsApp Status carry no ctwa_clid, and such chats cannot be reported.
function extractCtwaReferral(message) {
  const referral = message?.referral;
  const clid = typeof referral?.ctwa_clid === "string" ? referral.ctwa_clid.trim() : "";
  if (!clid || clid.length > 2048) return null;
  return defined({
    clid,
    adId: text(referral.source_id, 64),
    sourceType: text(referral.source_type, 32),
    sourceUrl: text(referral.source_url, 500),
    headline: text(referral.headline, 200),
    mediaType: text(referral.media_type, 32),
  });
}

// Keep the ad click on the conversation. The first ad that brought the customer wins; a later ad
// click in the same chat never replaces it.
async function captureReferral({ conversationId, message }, deps = defaultDeps) {
  const referral = extractCtwaReferral(message);
  if (!referral) return { skipped: "no_click_id" };
  if (!conversationId) return { skipped: "no_conversation" };
  const seconds = Number(message.timestamp);
  const capturedAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : deps.now();
  const result = await deps.Conversation.updateOne(
    { _id: conversationId, "ctwa.clid": null },
    { $set: { ctwa: { ...referral, capturedAt } } }
  );
  return result?.matchedCount ? { captured: true, adId: referral.adId || null } : { skipped: "first_touch_kept" };
}

const pickDatasetId = (body) => {
  const id = body?.id ?? body?.data?.[0]?.id;
  return id !== undefined && id !== null && GRAPH_ID.test(String(id)) ? String(id) : null;
};

// The WABA's Conversions API dataset, saved on the account after the first lookup.
async function getOrCreateDataset(account, deps = defaultDeps) {
  const wabaId = String(account.wabaId || "");
  if (!GRAPH_ID.test(wabaId)) throw Object.assign(new Error("The connected WhatsApp account has no valid WABA id"), { code: "NO_WABA" });
  const saved = account.capiDataset;
  if (saved?.datasetId && String(saved.wabaId) === wabaId) return String(saved.datasetId);

  let datasetId = null;
  try {
    datasetId = pickDatasetId(await deps.graph.get(`/${wabaId}/dataset`, account.accessToken));
  } catch (_) {
    // The Dataset reference lists reading this edge as unsupported. POST answers with the WABA's
    // existing dataset when there is one, so it is safe to fall through to it.
  }
  if (!datasetId) datasetId = pickDatasetId(await deps.graph.post(`/${wabaId}/dataset`, {}, account.accessToken));
  if (!datasetId) throw Object.assign(new Error("Meta did not return a dataset for this WhatsApp account"), { code: "NO_DATASET" });

  try {
    await deps.Account.updateOne({ _id: account._id }, { $set: { capiDataset: { datasetId, wabaId, savedAt: deps.now() } } });
  } catch (err) {
    console.warn(`[WA Conversions] could not save dataset ${datasetId} for WABA ${wabaId}:`, err.message);
  }
  return datasetId;
}

// A Graph error as a code the app can act on. Never 401: the app signs the user out on a 401.
function describeGraphError(err) {
  const meta = err?.response?.data?.error;
  const metaCode = Number(meta?.code);
  const detail = String(meta?.error_user_msg || meta?.message || err?.message || "Unknown error").slice(0, 500);
  const errorMessage = Number.isFinite(metaCode) ? `${detail} (Meta error ${metaCode})` : detail;
  if (metaCode === 190) {
    return {
      code: "WHATSAPP_TOKEN_INVALID",
      message: "The WhatsApp connection has expired. Reconnect WhatsApp in MarketingKart and try again.",
      errorMessage,
    };
  }
  if (metaCode === 10 || (metaCode >= 200 && metaCode <= 299)) {
    return {
      code: "EVENTS_PERMISSION_MISSING",
      message:
        "MarketingKart is not allowed to report ad conversions for this WhatsApp account yet. Reconnect WhatsApp and allow event management (whatsapp_business_manage_events).",
      errorMessage,
    };
  }
  return {
    code: "META_ERROR",
    message: meta ? `Meta did not accept the event: ${detail}` : `Could not report this to Meta: ${detail}`,
    errorMessage,
  };
}

function readInput({ event, value }) {
  const key = String(event || "").trim().toLowerCase();
  const eventName = EVENTS[key];
  if (!eventName) return { error: fail(400, "INVALID_EVENT", 'event must be "lead" or "purchase"') };

  let amount = 0;
  if (value !== undefined && value !== null && value !== "") {
    if (typeof value === "number") amount = value;
    else if (typeof value === "string") amount = Number(value.trim());
    else amount = NaN;
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_VALUE) {
      return { error: fail(400, "INVALID_VALUE", "value must be an amount in rupees between 0 and 1,00,00,00,000") };
    }
    amount = Math.round(amount * 100) / 100;
  }
  if (eventName === "Purchase" && !(amount > 0)) {
    return { error: fail(400, "INVALID_VALUE", "Enter the sale amount in rupees (more than 0)") };
  }
  return { eventName, value: amount };
}

async function loadOwnedConversation(userId, conversationId, deps) {
  if (!OBJECT_ID.test(String(conversationId || ""))) return { error: fail(404, "NOT_FOUND", "Conversation not found") };
  const conversation = await deps.Conversation.findById(conversationId).select("+ctwa.clid").lean();
  if (!conversation) return { error: fail(404, "NOT_FOUND", "Conversation not found") };
  const owner = conversation.businessId
    ? await deps.Business.findOne({ _id: conversation.businessId, userId }).select("_id").lean()
    : null;
  if (!owner) return { error: fail(403, "FORBIDDEN", "You do not have access to this conversation") };
  return { conversation };
}

const describeEvent = (record) =>
  record
    ? {
        event: record.eventName === EVENTS.purchase ? "purchase" : "lead",
        eventName: record.eventName,
        status: record.status,
        value: record.value ?? 0,
        currency: record.currency || CURRENCY,
        attempts: record.attempts ?? 1,
        sentAt: record.sentAt || null,
        errorCode: record.status === "FAILED" ? record.errorCode || null : null,
        errorMessage: record.status === "FAILED" ? record.errorMessage || null : null,
      }
    : null;

// Reserve the (conversation, event) slot before calling Meta, so two taps or two devices can never
// report the same lead or sale twice. Only a failed send, or one stuck far longer than a send can
// take, is tried again, and it keeps its event_id.
async function claimEvent({ conversation, account, userId, eventName, value, now }, deps) {
  const slot = { conversationId: conversation._id, eventName };
  const attempt = { value, currency: CURRENCY, eventTime: now, lockedAt: now };
  try {
    const record = await deps.ConversionEvent.create({
      ...slot,
      ...attempt,
      businessId: conversation.businessId,
      userId,
      wabaId: String(account.wabaId),
      phoneNumberId: conversation.phoneNumberId,
      adId: conversation.ctwa?.adId,
      eventId: `wa-${conversation._id}-${eventName}`,
      status: "SENDING",
      attempts: 1,
    });
    return { record: plain(record) };
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }

  const retried = await deps.ConversionEvent.findOneAndUpdate(
    { ...slot, $or: [{ status: "FAILED" }, { status: "SENDING", lockedAt: { $lt: new Date(now.getTime() - LOCK_MS) } }] },
    { $set: { ...attempt, status: "SENDING", errorCode: null, errorMessage: null }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (retried) return { record: plain(retried) };

  const existing = plain(await deps.ConversionEvent.findOne(slot).lean());
  if (existing?.status === "SENT") {
    return { reply: ok(200, "Already reported to Meta", describeEvent(existing), { alreadySent: true }) };
  }
  return { reply: fail(409, "IN_PROGRESS", "This is being reported to Meta right now. Try again in a minute.") };
}

async function sendEvent({ datasetId, account, clid, record }, deps) {
  const { partnerAgent, testEventCode } = deps.config();
  const body = {
    data: [
      {
        event_name: record.eventName,
        event_time: Math.floor(new Date(record.eventTime).getTime() / 1000),
        event_id: record.eventId,
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: { whatsapp_business_account_id: String(account.wabaId), ctwa_clid: clid },
        custom_data: { currency: CURRENCY, value: record.value },
      },
    ],
  };
  if (partnerAgent) body.partner_agent = partnerAgent;
  if (testEventCode) body.test_event_code = testEventCode;

  const response = await deps.graph.post(`/${datasetId}/events`, body, account.accessToken);
  const received = response?.events_received;
  if (received !== undefined && received !== null && !(Number(received) >= 1)) {
    const notes = Array.isArray(response?.messages) ? response.messages.join("; ") : "";
    throw new Error(`Meta received no event${notes ? `: ${notes}` : ""}`);
  }
  return {
    eventsReceived: received === undefined || received === null ? null : Number(received),
    fbtraceId: response?.fbtrace_id || null,
  };
}

// POST /api/whatsapp/chat/conversations/:conversationId/conversion  { event: "lead"|"purchase", value }
async function markConversation({ userId, conversationId, event, value }, deps = defaultDeps) {
  const input = readInput({ event, value });
  if (input.error) return input.error;

  const { conversation, error } = await loadOwnedConversation(userId, conversationId, deps);
  if (error) return error;

  const clid = conversation.ctwa?.clid;
  if (!clid) {
    return fail(409, "NOT_FROM_AD", "Only chats that started from a Click-to-WhatsApp ad can be reported to Meta.");
  }

  const account = await deps.Account.findOne({ userId, phoneNumberId: conversation.phoneNumberId, status: "CONNECTED" });
  if (!account) return fail(404, "WHATSAPP_NOT_CONNECTED", "Connect the WhatsApp number of this chat first.");
  if (String(account.wabaId) !== String(conversation.wabaId)) {
    return fail(409, "WABA_MISMATCH", "This chat belongs to a different WhatsApp Business account than the one connected now.");
  }

  const claim = await claimEvent(
    { conversation, account, userId, eventName: input.eventName, value: input.value, now: deps.now() },
    deps
  );
  if (claim.reply) return claim.reply;
  const record = claim.record;

  let datasetId;
  let result;
  try {
    datasetId = await getOrCreateDataset(account, deps);
    result = await sendEvent({ datasetId, account, clid, record }, deps);
  } catch (err) {
    const problem = describeGraphError(err);
    // How the app can get the missing permission: a number connected with the Facebook SDK ("Existing
    // API number") allows it in the app's separate Facebook login; an Embedded Signup number reconnects.
    let fix;
    if (problem.code === "EVENTS_PERMISSION_MISSING") {
      fix = account.connectedVia === "FACEBOOK" ? "ALLOW_EVENTS" : "RECONNECT";
      if (fix === "ALLOW_EVENTS") {
        problem.message =
          "Allow MarketingKart to report ad leads and sales for this WhatsApp number (whatsapp_business_manage_events), then try again.";
      }
    }
    const failed = { status: "FAILED", errorCode: problem.code, errorMessage: problem.errorMessage };
    if (datasetId) failed.datasetId = datasetId;
    console.warn(`[WA Conversions] ${record.eventName} for conversation ${conversation._id} failed: ${problem.code} ${problem.errorMessage}`);
    try {
      await deps.ConversionEvent.updateOne({ _id: record._id }, { $set: failed });
    } catch (saveErr) {
      console.error(`[WA Conversions] could not record the failure for ${record._id}:`, saveErr.message);
    }
    return fail(502, problem.code, problem.message, { data: describeEvent({ ...record, ...failed }), ...(fix ? { fix } : {}) });
  }

  const sent = {
    status: "SENT",
    datasetId,
    sentAt: deps.now(),
    eventsReceived: result.eventsReceived,
    fbtraceId: result.fbtraceId,
    errorCode: null,
    errorMessage: null,
  };
  await deps.ConversionEvent.updateOne({ _id: record._id }, { $set: sent });
  const label = record.eventName === EVENTS.purchase ? "Sale" : "Lead";
  return ok(201, `${label} reported to Meta`, describeEvent({ ...record, ...sent }));
}

// GET /api/whatsapp/chat/conversations/:conversationId/conversion
async function getConversionState({ userId, conversationId }, deps = defaultDeps) {
  const { conversation, error } = await loadOwnedConversation(userId, conversationId, deps);
  if (error) return error;

  const records = await deps.ConversionEvent.find({ conversationId: conversation._id }).lean();
  const byName = Object.fromEntries((records || []).map((r) => [r.eventName, r]));
  const fromAd = Boolean(conversation.ctwa?.clid);
  const events = { lead: describeEvent(byName[EVENTS.lead]), purchase: describeEvent(byName[EVENTS.purchase]) };
  const canMark = (e) => fromAd && (!e || e.status === "FAILED");
  const ctwa = conversation.ctwa || {};

  return ok(200, "Conversion status", {
    conversationId: String(conversation._id),
    fromAd,
    ad: fromAd
      ? {
          adId: ctwa.adId || null,
          sourceType: ctwa.sourceType || null,
          sourceUrl: ctwa.sourceUrl || null,
          headline: ctwa.headline || null,
          mediaType: ctwa.mediaType || null,
          capturedAt: ctwa.capturedAt || null,
        }
      : null,
    events,
    canMark: { lead: canMark(events.lead), purchase: canMark(events.purchase) },
  });
}

module.exports = {
  EVENTS,
  CURRENCY,
  LOCK_MS,
  extractCtwaReferral,
  captureReferral,
  getOrCreateDataset,
  describeGraphError,
  markConversation,
  getConversionState,
};
