// WhatsApp Flows for MarketingKart users: build forms in the app, keep them in sync with Meta,
// send them in chat and read the answers that come back.
// Flows API: https://developers.facebook.com/docs/whatsapp/flows/reference/flowsapi
// Sending: https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/sendingaflow
// Replies (nfm_reply): https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowswebhooks
const axios = require("axios");
const FormData = require("form-data");
const builder = require("./whatsappFlowBuilder");
const Flow = require("../models/whatsappFlowModel");
const FlowResponse = require("../models/whatsappFlowResponseModel");
const Account = require("../models/whatsappAccountModel");
const Conversation = require("../models/whatsappConversationModel");
const Message = require("../models/whatsappMessageModel");
const Business = require("../models/businessModel");

class FlowError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

const graphBase = () => `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || "v22.0"}`;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function metaError(err) {
  const meta = err?.response?.data?.error;
  const wrapped = new Error(meta?.error_user_msg || meta?.message || err?.message || "Meta request failed");
  wrapped.isMeta = true;
  wrapped.metaCode = meta?.code;
  return wrapped;
}

const graph = {
  get: (path, token, params) =>
    axios
      .get(`${graphBase()}${path}`, { params, headers: bearer(token), timeout: 20000 })
      .then((r) => r.data)
      .catch((e) => Promise.reject(metaError(e))),
  post: (path, token, body = {}) =>
    axios
      .post(`${graphBase()}${path}`, body, { headers: { ...bearer(token), "Content-Type": "application/json" }, timeout: 20000 })
      .then((r) => r.data)
      .catch((e) => Promise.reject(metaError(e))),
  // Flow JSON goes up as a multipart file named flow.json (POST /{flow-id}/assets).
  upload: (path, token, flowJson) => {
    const form = new FormData();
    form.append("file", Buffer.from(JSON.stringify(flowJson)), { filename: "flow.json", contentType: "application/json" });
    form.append("name", "flow.json");
    form.append("asset_type", "FLOW_JSON");
    return axios
      .post(`${graphBase()}${path}`, form, { headers: { ...bearer(token), ...form.getHeaders() }, timeout: 30000 })
      .then((r) => r.data)
      .catch((e) => Promise.reject(metaError(e)));
  },
  del: (path, token) =>
    axios
      .delete(`${graphBase()}${path}`, { headers: bearer(token), timeout: 20000 })
      .then((r) => r.data)
      .catch((e) => Promise.reject(metaError(e))),
};

const defaultDeps = {
  Flow,
  FlowResponse,
  Account,
  Conversation,
  Message,
  Business,
  graph,
  sendInteractive: (...args) => require("./whatsappCloudApiService").sendInteractiveMessage(...args),
  io: () => global.io,
  now: () => new Date(),
};

const ID_RE = /^[a-f0-9]{24}$/i;
const TOKEN_PREFIX = "mkf_";
const flowToken = (metaFlowId) => `${TOKEN_PREFIX}${metaFlowId}`;
const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const trimErrors = (errors) => (Array.isArray(errors) ? errors.slice(0, 20) : []);

function parseDate(value, fallback) {
  if (!value) return fallback;
  let date = new Date(value);
  if (Number.isNaN(date.getTime())) date = new Date(String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function publicFlow(flow) {
  const f = flow?.toObject ? flow.toObject() : { ...flow };
  return {
    _id: String(f._id),
    name: f.name,
    categories: f.categories || [],
    status: f.status,
    metaFlowId: f.metaFlowId,
    starter: f.starter || null,
    source: f.source || "APP",
    editable: Boolean(f.definition),
    definition: f.definition || null,
    firstScreen: f.definition ? builder.screenId(0) : null,
    validationErrors: f.validationErrors || [],
    responseCount: f.responseCount || 0,
    lastResponseAt: f.lastResponseAt || null,
    publishedAt: f.publishedAt || null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

function cleanMeta({ name, categories }, { partial = false } = {}) {
  const out = {};
  if (name !== undefined || !partial) {
    const value = clean(name);
    if (!value) throw new FlowError(400, "INVALID_NAME", "Give the flow a name.");
    if (value.length > builder.LIMITS.name) {
      throw new FlowError(400, "INVALID_NAME", `Flow name can be at most ${builder.LIMITS.name} characters.`);
    }
    out.name = value;
  }
  if (categories !== undefined || !partial) {
    const list = [...new Set((Array.isArray(categories) ? categories : [categories]).map((c) => clean(c).toUpperCase()).filter(Boolean))];
    if (!list.length) throw new FlowError(400, "INVALID_CATEGORY", "Choose a category for the flow.");
    const unknown = list.find((c) => !builder.CATEGORIES.includes(c));
    if (unknown) throw new FlowError(400, "INVALID_CATEGORY", `Unknown flow category: ${unknown}.`);
    out.categories = list;
  }
  return out;
}

function checkedDefinition(raw) {
  const { definition, errors } = builder.normalizeDefinition(raw);
  if (errors.length) throw new FlowError(400, "INVALID_FORM", errors[0].message, { errors });
  return definition;
}

async function connectedAccount(userId, deps) {
  const account = await deps.Account.findOne({ userId, status: "CONNECTED" });
  if (!account) throw new FlowError(409, "WHATSAPP_NOT_CONNECTED", "Connect your WhatsApp number first.");
  return account;
}

async function ownedFlow(userId, flowId, deps) {
  if (!ID_RE.test(String(flowId || ""))) throw new FlowError(404, "FLOW_NOT_FOUND", "Flow not found.");
  const flow = await deps.Flow.findOne({ _id: flowId, userId });
  if (!flow) throw new FlowError(404, "FLOW_NOT_FOUND", "Flow not found.");
  return flow;
}

async function accountForFlow(userId, flow, deps) {
  const account = await connectedAccount(userId, deps);
  if (String(account.wabaId) !== String(flow.wabaId)) {
    throw new FlowError(409, "WABA_MISMATCH", "This flow belongs to a WhatsApp account that is no longer connected.");
  }
  return account;
}

// Meta reports a flow's real status; editing a published flow moves it back to DRAFT.
async function readStatus(flow, account, deps) {
  return deps.graph.get(`/${flow.metaFlowId}`, account.accessToken, { fields: "id,status,validation_errors" }).catch(() => null);
}

function listStarters() {
  return {
    starters: builder.STARTERS.map((s) => builder.starter(s.key)).map(({ key, title, description, category, definition }) => ({
      key,
      title,
      description,
      category,
      definition,
    })),
    categories: builder.CATEGORIES,
    fieldTypes: Object.entries(builder.FIELD_TYPES).map(([type, spec]) => ({
      type,
      labelMax: spec.labelMax,
      hasOptions: Boolean(spec.options),
      maxOptions: spec.options?.max || 0,
    })),
    limits: builder.LIMITS,
  };
}

async function listFlows(userId, deps = defaultDeps) {
  const account = await deps.Account.findOne({ userId, status: "CONNECTED" });
  if (!account) return { connected: false, flows: [] };
  const flows = await deps.Flow.find({ userId, wabaId: String(account.wabaId) }).sort({ updatedAt: -1 }).limit(200);
  return { connected: true, flows: flows.map(publicFlow) };
}

async function getFlow(userId, flowId, deps = defaultDeps) {
  return publicFlow(await ownedFlow(userId, flowId, deps));
}

async function createFlow(userId, input = {}, deps = defaultDeps) {
  const start = input.starter ? builder.starter(input.starter) : null;
  if (input.starter && !start) throw new FlowError(400, "INVALID_STARTER", "Unknown flow template.");
  const meta = cleanMeta({ name: input.name, categories: input.categories ?? start?.category });
  const definition = checkedDefinition(input.definition ?? start?.definition);
  const account = await connectedAccount(userId, deps);

  const flowJson = builder.buildFlowJson(definition);
  const created = await deps.graph.post(`/${account.wabaId}/flows`, account.accessToken, {
    name: meta.name,
    categories: meta.categories,
    flow_json: JSON.stringify(flowJson),
  });
  if (!created?.id) throw new FlowError(502, "META_ERROR", "Meta did not return a flow id.");

  const flow = await deps.Flow.create({
    userId,
    wabaId: String(account.wabaId),
    metaFlowId: String(created.id),
    name: meta.name,
    categories: meta.categories,
    starter: start?.key || null,
    definition,
    flowJson,
    status: "DRAFT",
    validationErrors: trimErrors(created.validation_errors),
    source: "APP",
  });
  return publicFlow(flow);
}

async function updateFlow(userId, flowId, input = {}, deps = defaultDeps) {
  const flow = await ownedFlow(userId, flowId, deps);
  if (flow.status === "DEPRECATED") {
    throw new FlowError(409, "FLOW_DEPRECATED", "This flow is retired. Create a new flow instead.");
  }
  if (input.definition !== undefined && !flow.definition) {
    throw new FlowError(409, "NOT_EDITABLE", "This flow was made in WhatsApp Manager. Edit it there, or create a new flow in the app.");
  }
  const meta = cleanMeta({ name: input.name, categories: input.categories }, { partial: true });
  const definition = input.definition !== undefined ? checkedDefinition(input.definition) : null;
  const account = await accountForFlow(userId, flow, deps);

  const changes = {};
  const metadata = {};
  if (meta.name && meta.name !== flow.name) metadata.name = meta.name;
  if (meta.categories && meta.categories.join() !== (flow.categories || []).join()) metadata.categories = meta.categories;
  if (Object.keys(metadata).length) {
    await deps.graph.post(`/${flow.metaFlowId}`, account.accessToken, metadata);
    Object.assign(changes, metadata);
  }
  if (definition) {
    const flowJson = builder.buildFlowJson(definition);
    const uploaded = await deps.graph.upload(`/${flow.metaFlowId}/assets`, account.accessToken, flowJson);
    Object.assign(changes, {
      definition,
      flowJson,
      validationErrors: trimErrors(uploaded?.validation_errors),
      previewUrl: null,
      previewExpiresAt: null,
    });
  }
  if (!Object.keys(changes).length) return publicFlow(flow);

  const fresh = await readStatus(flow, account, deps);
  if (fresh?.status) changes.status = fresh.status;
  if (!definition && Array.isArray(fresh?.validation_errors)) changes.validationErrors = trimErrors(fresh.validation_errors);
  const saved = await deps.Flow.findOneAndUpdate({ _id: flow._id, userId }, { $set: changes }, { new: true });
  return publicFlow(saved);
}

async function publishFlow(userId, flowId, deps = defaultDeps) {
  const flow = await ownedFlow(userId, flowId, deps);
  if (flow.status === "PUBLISHED") return publicFlow(flow);
  if (flow.status !== "DRAFT") {
    throw new FlowError(409, "FLOW_NOT_PUBLISHABLE", `A ${String(flow.status).toLowerCase()} flow cannot be published.`);
  }
  if (flow.validationErrors?.length) {
    throw new FlowError(400, "FLOW_HAS_ERRORS", "Fix the errors in this flow before publishing.", { errors: flow.validationErrors });
  }
  const account = await accountForFlow(userId, flow, deps);
  await deps.graph.post(`/${flow.metaFlowId}/publish`, account.accessToken, {});
  const fresh = await readStatus(flow, account, deps);
  const saved = await deps.Flow.findOneAndUpdate(
    { _id: flow._id, userId },
    { $set: { status: fresh?.status || "PUBLISHED", publishedAt: deps.now() } },
    { new: true }
  );
  return publicFlow(saved);
}

async function previewFlow(userId, flowId, deps = defaultDeps) {
  const flow = await ownedFlow(userId, flowId, deps);
  const now = deps.now();
  const cachedUntil = flow.previewExpiresAt ? new Date(flow.previewExpiresAt).getTime() : 0;
  if (flow.previewUrl && cachedUntil - now.getTime() > 60 * 60 * 1000) {
    return { previewUrl: flow.previewUrl, expiresAt: flow.previewExpiresAt };
  }
  const account = await accountForFlow(userId, flow, deps);
  const data = await deps.graph.get(`/${flow.metaFlowId}`, account.accessToken, { fields: "preview.invalidate(false)" });
  const previewUrl = data?.preview?.preview_url;
  if (!previewUrl || !/^https:\/\//.test(previewUrl)) throw new FlowError(502, "META_ERROR", "Meta did not return a preview link.");
  const expiresAt = parseDate(data.preview.expires_at, new Date(now.getTime() + 24 * 60 * 60 * 1000));
  await deps.Flow.updateOne({ _id: flow._id }, { $set: { previewUrl, previewExpiresAt: expiresAt } });
  return { previewUrl, expiresAt };
}

async function deprecateFlow(userId, flowId, deps = defaultDeps) {
  const flow = await ownedFlow(userId, flowId, deps);
  if (flow.status === "DEPRECATED") return publicFlow(flow);
  if (flow.status !== "PUBLISHED") {
    throw new FlowError(409, "FLOW_NOT_PUBLISHED", "Only a published flow can be retired. Delete a draft instead.");
  }
  const account = await accountForFlow(userId, flow, deps);
  await deps.graph.post(`/${flow.metaFlowId}/deprecate`, account.accessToken, {});
  const saved = await deps.Flow.findOneAndUpdate({ _id: flow._id, userId }, { $set: { status: "DEPRECATED" } }, { new: true });
  return publicFlow(saved);
}

async function deleteFlow(userId, flowId, deps = defaultDeps) {
  const flow = await ownedFlow(userId, flowId, deps);
  if (flow.status !== "DRAFT") {
    throw new FlowError(409, "FLOW_NOT_DRAFT", "Meta only lets you delete a draft. Retire a published flow instead.");
  }
  const account = await accountForFlow(userId, flow, deps);
  try {
    await deps.graph.del(`/${flow.metaFlowId}`, account.accessToken);
  } catch (err) {
    // Already gone on Meta (deleted in WhatsApp Manager): still remove our copy.
    if (!(err?.isMeta && Number(err.metaCode) === 100)) throw err;
  }
  await deps.Flow.deleteOne({ _id: flow._id, userId });
  return { deleted: true };
}

// Brings in flows made in WhatsApp Manager and refreshes the status of ours.
async function syncFlows(userId, deps = defaultDeps) {
  const account = await connectedAccount(userId, deps);
  const wabaId = String(account.wabaId);
  const remote = [];
  let after = null;
  let complete = false;
  for (let page = 0; page < 10; page += 1) {
    const data = await deps.graph.get(`/${wabaId}/flows`, account.accessToken, {
      fields: "id,name,status,categories,validation_errors",
      limit: 100,
      ...(after ? { after } : {}),
    });
    remote.push(...(Array.isArray(data?.data) ? data.data : []));
    after = data?.paging?.next ? data?.paging?.cursors?.after : null;
    if (!after) {
      complete = true;
      break;
    }
  }

  let added = 0;
  let updated = 0;
  for (const item of remote) {
    if (!item?.id) continue;
    const metaFlowId = String(item.id);
    const set = {
      name: clean(item.name) || `Flow ${metaFlowId}`,
      status: item.status || "DRAFT",
      categories: Array.isArray(item.categories) ? item.categories : [],
      validationErrors: trimErrors(item.validation_errors),
    };
    const existing = await deps.Flow.findOne({ wabaId, metaFlowId });
    if (existing && String(existing.userId) !== String(userId)) continue;
    if (existing) {
      await deps.Flow.updateOne({ _id: existing._id }, { $set: set });
      updated += 1;
    } else {
      await deps.Flow.create({ userId, wabaId, metaFlowId, source: "META", ...set });
      added += 1;
    }
  }

  let removed = 0;
  if (complete) {
    const ids = remote.map((item) => String(item.id));
    const result = await deps.Flow.deleteMany({ userId, wabaId, metaFlowId: { $nin: ids } });
    removed = result?.deletedCount || 0;
  }
  return { added, updated, removed, total: remote.length };
}

async function sendFlow(userId, flowId, input = {}, deps = defaultDeps) {
  const flow = await ownedFlow(userId, flowId, deps);
  if (!["PUBLISHED", "DRAFT"].includes(flow.status)) {
    throw new FlowError(409, "FLOW_NOT_SENDABLE", `A ${String(flow.status).toLowerCase()} flow cannot be sent.`);
  }
  if (flow.validationErrors?.length) {
    throw new FlowError(400, "FLOW_HAS_ERRORS", "Fix the errors in this flow before sending it.", { errors: flow.validationErrors });
  }
  const bodyText = clean(input.bodyText) || "Please fill in this short form.";
  const ctaText = clean(input.ctaText) || "Open form";
  const headerText = clean(input.headerText);
  if (bodyText.length > 1024) throw new FlowError(400, "INVALID_TEXT", "Message text can be at most 1024 characters.");
  if (ctaText.length > 30) throw new FlowError(400, "INVALID_TEXT", "Button text can be at most 30 characters.");
  if (headerText.length > 60) throw new FlowError(400, "INVALID_TEXT", "Heading can be at most 60 characters.");

  const conversationId = String(input.conversationId || "");
  if (!ID_RE.test(conversationId)) throw new FlowError(400, "INVALID_CONVERSATION", "Choose a chat to send the form to.");
  const conversation = await deps.Conversation.findById(conversationId);
  if (!conversation) throw new FlowError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
  const owner = await deps.Business.findOne({ _id: conversation.businessId, userId }).select("_id");
  if (!owner) throw new FlowError(403, "FORBIDDEN", "You do not have access to this conversation.");
  const account = await deps.Account.findOne({ userId, phoneNumberId: conversation.phoneNumberId, status: "CONNECTED" });
  if (!account) throw new FlowError(409, "WHATSAPP_NOT_CONNECTED", "WhatsApp is not connected for this conversation.");
  if (String(account.wabaId) !== String(flow.wabaId)) {
    throw new FlowError(409, "WABA_MISMATCH", "This flow belongs to a different WhatsApp account.");
  }

  const draft = flow.status === "DRAFT";
  const interactive = {
    type: "flow",
    ...(headerText ? { header: { type: "text", text: headerText } } : {}),
    body: { text: bodyText },
    action: {
      name: "flow",
      parameters: {
        flow_message_version: "3",
        flow_token: flowToken(flow.metaFlowId),
        flow_id: flow.metaFlowId,
        flow_cta: ctaText,
        flow_action: "navigate",
        ...(draft ? { mode: "draft" } : {}),
      },
    },
  };

  let response;
  try {
    response = await deps.sendInteractive(conversation.customerPhone, interactive, {
      accessToken: account.accessToken,
      phoneNumberId: account.phoneNumberId,
    });
  } catch (err) {
    if (String(err?.code) === "131047") {
      throw new FlowError(400, "REPLY_WINDOW_CLOSED", "The 24-hour reply window has closed. Send a template with this form's button instead.");
    }
    throw err;
  }

  const now = deps.now();
  const preview = `📋 ${bodyText}`;
  const message = await deps.Message.create({
    conversationId: conversation._id,
    businessId: conversation.businessId,
    phoneNumberId: conversation.phoneNumberId,
    to: conversation.customerPhone,
    contactName: conversation.customerName,
    direction: "OUTBOUND",
    type: "INTERACTIVE",
    textBody: preview,
    metaMessageId: response?.messages?.[0]?.id || null,
    status: "SENT",
    sentAt: now,
    source: "FLOW",
  });
  await deps.Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessage: preview.substring(0, 50), lastMessageAt: now } });

  const io = deps.io();
  if (io) {
    const payload = {
      _id: String(message._id),
      conversationId: String(conversation._id),
      customerPhone: conversation.customerPhone,
      textBody: preview,
      content: preview,
      direction: "OUTBOUND",
      senderType: "USER",
      type: "INTERACTIVE",
      messageType: "INTERACTIVE",
      status: "SENT",
      createdAt: message.createdAt || now,
      sentAt: now,
    };
    io.to(`conversation:${conversation._id}`).emit("newWhatsAppMessage", payload);
    io.to(`user:${userId}`).emit("newWhatsAppMessage", payload);
  }
  return { sent: true, draft, messageId: String(message._id) };
}

function parseReply(nfmReply) {
  let response = {};
  try {
    response = typeof nfmReply?.response_json === "string" ? JSON.parse(nfmReply.response_json) : nfmReply?.response_json || {};
  } catch (_) {
    response = {};
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) response = {};
  const token = String(response.flow_token || "");
  const metaFlowId = token.startsWith(TOKEN_PREFIX) && /^\d+$/.test(token.slice(TOKEN_PREFIX.length)) ? token.slice(TOKEN_PREFIX.length) : null;
  return { response, metaFlowId };
}

/**
 * Turns an inbound nfm_reply into readable chat text. The reply does not carry the flow id,
 * so we put it in flow_token when we send the flow (mkf_<flow id>).
 */
async function describeReply({ userId, wabaId, nfmReply }, deps = defaultDeps) {
  const { response, metaFlowId } = parseReply(nfmReply);
  const flow = metaFlowId && userId ? await deps.Flow.findOne({ userId, wabaId: String(wabaId), metaFlowId }) : null;
  const answers = builder.describeAnswers(flow?.definition, response);
  const title = flow?.name ? `📋 ${flow.name}` : "📋 Form submitted";
  const text = [title, ...answers.map((a) => `${a.label}: ${a.value}`)].join("\n").slice(0, 4000);
  return { flow, metaFlowId, response, answers, text };
}

async function recordReply(described, context, deps = defaultDeps) {
  if (!context?.wamid || !context?.userId) return { skipped: "missing" };
  try {
    await deps.FlowResponse.create({
      userId: context.userId,
      businessId: context.businessId || null,
      flowId: described.flow?._id || null,
      metaFlowId: described.metaFlowId,
      wabaId: context.wabaId ? String(context.wabaId) : null,
      phoneNumberId: context.phoneNumberId || null,
      conversationId: context.conversationId || null,
      customerPhone: context.customerPhone || null,
      customerName: context.customerName || null,
      wamid: context.wamid,
      answers: described.answers,
      raw: described.response,
      receivedAt: context.receivedAt || deps.now(),
    });
  } catch (err) {
    if (err?.code === 11000) return { skipped: "duplicate" };
    throw err;
  }
  if (described.flow?._id) {
    await deps.Flow.updateOne(
      { _id: described.flow._id },
      { $inc: { responseCount: 1 }, $set: { lastResponseAt: context.receivedAt || deps.now() } }
    );
  }
  return { recorded: true };
}

async function listResponses(userId, flowId, { page = 1 } = {}, deps = defaultDeps) {
  const flow = await ownedFlow(userId, flowId, deps);
  const limit = 20;
  const current = Math.max(parseInt(page, 10) || 1, 1);
  const query = { userId, flowId: flow._id };
  const [rows, total] = await Promise.all([
    deps.FlowResponse.find(query).sort({ receivedAt: -1 }).skip((current - 1) * limit).limit(limit),
    deps.FlowResponse.countDocuments(query),
  ]);
  return {
    responses: rows.map((r) => {
      const o = r?.toObject ? r.toObject() : r;
      return {
        _id: String(o._id),
        conversationId: o.conversationId ? String(o.conversationId) : null,
        customerPhone: o.customerPhone,
        customerName: o.customerName,
        answers: o.answers || [],
        receivedAt: o.receivedAt,
      };
    }),
    total,
    currentPage: current,
    hasMore: current * limit < total,
  };
}

// Meta and validation errors as HTTP answers. Never 401: the app signs out on 401.
function toHttp(err) {
  if (err instanceof FlowError) {
    return { status: err.status, body: { success: false, code: err.code, message: err.message, ...(err.errors ? { errors: err.errors } : {}) } };
  }
  const metaCode = err?.isMeta ? Number(err.metaCode) : err?.response?.data?.error ? Number(err.code) : null;
  if (metaCode !== null) {
    if (metaCode === 190) {
      return { status: 409, body: { success: false, code: "WHATSAPP_TOKEN_INVALID", message: "Your WhatsApp connection has expired. Reconnect WhatsApp and try again." } };
    }
    if (metaCode === 10 || (metaCode >= 200 && metaCode <= 299)) {
      return { status: 409, body: { success: false, code: "PERMISSION_MISSING", message: "MarketingKart is not allowed to manage this WhatsApp account. Reconnect WhatsApp and allow all permissions." } };
    }
    return { status: 502, body: { success: false, code: "META_ERROR", message: err.message || "Meta could not complete the request." } };
  }
  return { status: 500, body: { success: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." } };
}

module.exports = {
  FlowError,
  flowToken,
  parseReply,
  listStarters,
  listFlows,
  getFlow,
  createFlow,
  updateFlow,
  publishFlow,
  previewFlow,
  deprecateFlow,
  deleteFlow,
  syncFlows,
  sendFlow,
  describeReply,
  recordReply,
  listResponses,
  toHttp,
};
