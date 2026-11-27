// Integrations: store webhooks (Shopify, WooCommerce, Shiprocket) that send approved templates on
// events, Google Sheets contact sync, and the LeadSquared key check. CRM sync (HubSpot, Zoho CRM,
// LeadSquared) lives in whatsappCrmService; TallyPrime is listed but needs a desktop add-on.
const crypto = require("crypto");
const axios = require("axios");
const Integration = require("../models/whatsappIntegrationModel");
const OrderIndex = require("../models/whatsappOrderIndexModel");
const Sheet = require("../models/whatsappSheetModel");
const Template = require("../models/whatsappTemplateModel");
const Account = require("../models/whatsappAccountModel");
const Message = require("../models/whatsappMessageModel");
const Contact = require("../models/whatsappContactModel");
const Group = require("../models/whatsappContactGroupModel");
const Field = require("../models/whatsappContactFieldModel");
const cloud = require("./whatsappCloudApiService");
const billing = require("./whatsappBillingService");
const { buildComponents } = require("./whatsappCampaignService");
const { normalizePhone } = require("./whatsappContactService");

class IntegrationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const publicBase = () => (process.env.PUBLIC_API_URL || "https://api.marketingkart.in").replace(/\/$/, "");
const randomHex = (bytes = 24) => crypto.randomBytes(bytes).toString("hex");
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ""));

/* ---------- What each store app sends ---------- */
const STORE_APPS = {
  shopify: {
    name: "Shopify",
    events: [
      ["customer_created", "Customer Created", "Fires when a new customer is added to the store"],
      ["order_created", "Order Created", "Fires when a new order is placed"],
      ["order_updated", "Order Updated", "Fires when an order is edited, paid or changes status"],
      ["order_shipped", "Order Shipped", "Fires when an order is fulfilled with tracking"],
      ["order_out_for_delivery", "Order Out for Delivery", "Fires when the carrier marks the shipment out for delivery"],
      ["order_delivered", "Order Delivered", "Fires when the carrier marks the shipment delivered"],
    ],
    phoneFields: [["customer.phone", "Customer Phone"], ["phone", "Order Phone"], ["shipping_address.phone", "Shipping Address Phone"], ["billing_address.phone", "Billing Address Phone"]],
    fallbackPhones: ["customer.phone", "phone", "shipping_address.phone", "billing_address.phone", "destination.phone", "default_address.phone"],
    fields: [
      ["customer.first_name", "Customer first name"], ["customer.last_name", "Customer last name"], ["first_name", "First name (customer event)"],
      ["name", "Order name (#1001)"], ["order_number", "Order number"], ["total_price", "Order total"], ["currency", "Currency"],
      ["financial_status", "Payment status"], ["fulfillment_status", "Fulfilment status"], ["order_status_url", "Order status link"],
      ["line_items.0.title", "First product"], ["shipping_address.city", "Shipping city"], ["tracking_number", "Tracking number"],
      ["tracking_url", "Tracking link"], ["tracking_company", "Courier"], ["email", "Email"],
    ],
  },
  woocommerce: {
    name: "WooCommerce",
    events: [
      ["customer_created", "Customer Created", "Fires when a new customer registers"],
      ["order_created", "Order Created", "Fires when a new order is placed"],
      ["order_updated", "Order Updated", "Fires whenever an order changes"],
      ["order_processing", "Order Processing", "Fires when payment is received and the order is being prepared"],
      ["order_completed", "Order Completed", "Fires when the order is marked completed"],
      ["order_on_hold", "Order On Hold", "Fires when the order is put on hold (e.g. awaiting bank transfer)"],
      ["order_cancelled", "Order Cancelled", "Fires when the order is cancelled"],
      ["order_refunded", "Order Refunded", "Fires when the order is refunded"],
    ],
    phoneFields: [["billing.phone", "Billing Phone"], ["shipping.phone", "Shipping Phone"]],
    fallbackPhones: ["billing.phone", "shipping.phone"],
    fields: [
      ["billing.first_name", "Customer first name"], ["billing.last_name", "Customer last name"], ["first_name", "First name (customer event)"],
      ["number", "Order number"], ["id", "Order ID"], ["total", "Order total"], ["currency", "Currency"], ["status", "Order status"],
      ["payment_method_title", "Payment method"], ["line_items.0.name", "First product"], ["billing.city", "Billing city"], ["billing.email", "Email"],
    ],
  },
  shiprocket: {
    name: "Shiprocket",
    events: [
      ["shipment_picked_up", "Picked Up", "Fires when the courier picks up the shipment"],
      ["shipment_in_transit", "In Transit", "Fires when the shipment is shipped or in transit"],
      ["shipment_out_for_delivery", "Out for Delivery", "Fires when the shipment is out for delivery"],
      ["shipment_delivered", "Delivered", "Fires when the shipment is delivered"],
      ["shipment_ndr", "Delivery Failed (NDR)", "Fires when a delivery attempt fails"],
      ["shipment_rto", "Returning to Origin (RTO)", "Fires when the shipment is being returned"],
      ["shipment_cancelled", "Cancelled", "Fires when the shipment is cancelled"],
    ],
    phoneFields: [["order", "Customer of the store order (from Shopify/WooCommerce)"], ["customer_phone", "customer_phone field"]],
    fallbackPhones: ["customer_phone", "phone"],
    fields: [
      ["customer_name", "Customer name (from the store order)"], ["order_id", "Order ID"], ["awb", "AWB / tracking number"],
      ["courier_name", "Courier"], ["current_status", "Shipment status"], ["etd", "Expected delivery"],
      ["scans.0.location", "Latest scan location"],
    ],
  },
};
const OTHER_APPS = {
  google_sheets: { name: "Google Sheets" },
  leadsquared: { name: "LeadSquared" },
  hubspot: { name: "HubSpot", oauthEnv: ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"] },
  zoho: { name: "Zoho CRM", oauthEnv: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"] },
  tally: { name: "TallyPrime" },
};

/** Read "a.b.0.c" from an object. */
function getPath(obj, path) {
  return String(path || "").split(".").reduce((v, k) => (v === undefined || v === null ? undefined : v[k]), obj);
}

/* ---------- Event detection per app ---------- */
function shopifyEvents(topic, body) {
  const t = String(topic || "").toLowerCase();
  if (t === "customers/create") return ["customer_created"];
  if (t === "orders/create") return ["order_created"];
  if (t === "orders/updated") return ["order_updated"];
  if (t === "fulfillments/create") return ["order_shipped"];
  if (t === "fulfillments/update" || t === "fulfillment_events/create") {
    const s = String(body?.shipment_status || body?.status || "").toLowerCase();
    if (s === "out_for_delivery") return ["order_out_for_delivery"];
    if (s === "delivered") return ["order_delivered"];
  }
  return [];
}

function wooEvents(topic, body) {
  const t = String(topic || "").toLowerCase();
  if (t === "customer.created") return ["customer_created"];
  if (t === "order.created") return ["order_created"];
  if (t === "order.updated") {
    const status = String(body?.status || "").toLowerCase().replace(/-/g, "_");
    const out = ["order_updated"];
    if (["processing", "completed", "on_hold", "cancelled", "refunded"].includes(status)) out.push(`order_${status}`);
    return out;
  }
  return [];
}

function shiprocketEvents(body) {
  const s = String(body?.current_status || body?.shipment_status || "").toUpperCase();
  if (!s) return [];
  if (s.includes("UNDELIVERED") || s.includes("NDR") || s.includes("FAILED")) return ["shipment_ndr"];
  if (s.includes("OUT FOR DELIVERY")) return ["shipment_out_for_delivery"];
  if (s.includes("DELIVERED")) return ["shipment_delivered"];
  if (s.includes("RTO")) return ["shipment_rto"];
  if (s.includes("CANCEL")) return ["shipment_cancelled"];
  if (s.includes("PICKED UP") || s.includes("PICKUP")) return ["shipment_picked_up"];
  if (s.includes("SHIPPED") || s.includes("TRANSIT")) return ["shipment_in_transit"];
  return [];
}

/* ---------- Signatures ---------- */
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
const hmacBase64 = (secret, raw) => crypto.createHmac("sha256", secret).update(raw || Buffer.alloc(0)).digest("base64");

/* ---------- Connect / list ---------- */
function view(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : { ...doc };
  delete o.secret;
  delete o.credentials;
  const store = STORE_APPS[o.app];
  return {
    ...o,
    webhookUrl: store ? `${publicBase()}/api/webhooks/ecommerce/${o.app}/${o.token}` : undefined,
  };
}

async function listIntegrations(userId) {
  const rows = await Integration.find({ userId }).lean();
  const sheets = await Sheet.countDocuments({ userId });
  const by = Object.fromEntries(rows.map((r) => [r.app, view(r)]));
  const apps = {};
  for (const [key, spec] of Object.entries(STORE_APPS)) {
    apps[key] = { name: spec.name, connected: Boolean(by[key]), integration: by[key] || null, events: spec.events, phoneFields: spec.phoneFields, fields: spec.fields };
  }
  for (const [key, spec] of Object.entries(OTHER_APPS)) {
    apps[key] = {
      name: spec.name,
      connected: key === "google_sheets" ? sheets > 0 : Boolean(by[key]),
      integration: by[key] || null,
      available: spec.oauthEnv ? spec.oauthEnv.every((k) => process.env[k]) : true,
    };
  }
  return apps;
}

async function connectStore(userId, app, body = {}) {
  if (!STORE_APPS[app]) throw new IntegrationError(404, "Unknown app.");
  const secret = String(body.secret || "").trim();
  if (secret.length < 8 || secret.length > 200) throw new IntegrationError(400, app === "shiprocket" ? "Paste the security token (at least 8 characters)." : "Paste the webhook signing secret (at least 8 characters).");
  let label = String(body.label || "").trim().slice(0, 200);
  if (app === "shopify" && label && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(label)) throw new IntegrationError(400, "Shop domain looks like yourstore.myshopify.com");
  if (app === "woocommerce" && label && !/^https?:\/\/\S+\.\S+/i.test(label)) throw new IntegrationError(400, "Store URL starts with https://");
  const existing = await Integration.findOne({ userId, app });
  if (existing) {
    existing.secret = secret;
    existing.label = label;
    await existing.save();
    return view(existing);
  }
  const doc = await Integration.create({ userId, app, token: randomHex(24), secret, label });
  return view(doc);
}

async function disconnect(userId, app) {
  const r = await Integration.deleteOne({ userId, app });
  if (!r.deletedCount) throw new IntegrationError(404, "This app is not connected.");
  return { disconnected: true };
}

/* ---------- Mappings ---------- */
async function cleanMapping(userId, app, body = {}) {
  const spec = STORE_APPS[app];
  if (!spec) throw new IntegrationError(404, "Unknown app.");
  const event = String(body.event || "");
  if (!spec.events.some(([k]) => k === event)) throw new IntegrationError(400, "Choose an event.");
  if (!isId(body.templateId)) throw new IntegrationError(400, "Choose an approved template.");
  const template = await Template.findOne({ _id: body.templateId, createdBy: userId, disable: { $ne: true } }).select("status name").lean();
  if (!template) throw new IntegrationError(400, "Choose one of your templates.");
  if (template.status !== "APPROVED") throw new IntegrationError(400, "That template is not approved by Meta yet.");
  const phoneField = String(body.phoneField || spec.phoneFields[0][0]);
  if (!spec.phoneFields.some(([k]) => k === phoneField)) throw new IntegrationError(400, "Choose where the phone number comes from.");
  const variables = {};
  for (const [k, v] of Object.entries(body.variables || {})) {
    const key = String(k).replace(/[{}\s]/g, "").slice(0, 60);
    if (!key) continue;
    if (v && typeof v === "object" && "text" in v) variables[key] = { text: String(v.text || "").slice(0, 500) };
    else if (typeof v === "string" && v) variables[key] = v.slice(0, 120);
  }
  return { event, templateId: template._id, phoneField, variables, enabled: body.enabled !== false };
}

async function addMapping(userId, app, body) {
  const doc = await Integration.findOne({ userId, app });
  if (!doc) throw new IntegrationError(409, "Connect the store first.");
  if (doc.mappings.length >= 50) throw new IntegrationError(400, "Use at most 50 mappings.");
  doc.mappings.push(await cleanMapping(userId, app, body));
  await doc.save();
  return view(doc);
}

async function updateMapping(userId, app, mappingId, body) {
  const doc = await Integration.findOne({ userId, app });
  const m = doc?.mappings.id(mappingId);
  if (!m) throw new IntegrationError(404, "Mapping not found.");
  if (Object.keys(body || {}).length === 1 && typeof body.enabled === "boolean") m.enabled = body.enabled;
  else Object.assign(m, await cleanMapping(userId, app, body));
  doc.markModified("mappings");
  await doc.save();
  return view(doc);
}

async function removeMapping(userId, app, mappingId) {
  const doc = await Integration.findOne({ userId, app });
  const m = doc?.mappings.id(mappingId);
  if (!m) throw new IntegrationError(404, "Mapping not found.");
  m.deleteOne();
  await doc.save();
  return view(doc);
}

/* ---------- Sending one template, billed like a campaign message ---------- */
async function sendTemplate({ userId, template, to, variables, name }) {
  const account = await Account.findOne({ userId, status: "CONNECTED" });
  if (!account?.phoneNumberId || !account?.accessToken) throw new IntegrationError(409, "WhatsApp number is not connected.");
  const category = billing.categoryOf(template);
  const hold = await billing.reserveCampaign({ userId, category, count: 1 });
  const components = buildComponents(variables, template.components || [], template);
  let meta;
  try {
    meta = await cloud.sendTemplateMessage(to, template.name, template.language || "en_US", components, { accessToken: account.accessToken, phoneNumberId: account.phoneNumberId });
  } catch (error) {
    await billing.releaseHold(hold).catch(() => {});
    throw error;
  }
  const source = hold.sources?.[0] || null;
  let body = template.bodyText || template.name;
  for (const [k, v] of Object.entries(variables || {})) body = body.split(`{{${k}}}`).join(v);
  await Message.create({
    to,
    contactName: name || "",
    phoneNumberId: account.phoneNumberId,
    direction: "OUTBOUND",
    type: "TEMPLATE",
    textBody: body.slice(0, 1000),
    templateName: template.name,
    source: "INTEGRATION",
    metaMessageId: meta?.messages?.[0]?.id || null,
    status: "SENT",
    sentAt: new Date(),
    billingState: source ? "reserved" : "none",
    billCategory: category,
    billSource: source,
    billPaise: source === "wallet" ? hold.sellPaise || 0 : 0,
    billUserId: userId,
  });
  return meta?.messages?.[0]?.id || null;
}

function valuesFor(mapping, payload) {
  const out = {};
  for (const [key, rule] of Object.entries(mapping.variables || {})) {
    const raw = rule && typeof rule === "object" ? rule.text : getPath(payload, rule);
    const value = raw === undefined || raw === null ? "" : String(raw).trim();
    if (value) out[key] = value.slice(0, 500);
  }
  return out;
}

async function phoneFor(integration, mapping, payload) {
  const spec = STORE_APPS[integration.app];
  if (integration.app === "shiprocket") {
    const direct = normalizePhone(getPath(payload, "customer_phone") || getPath(payload, "phone"));
    if (direct) return { phone: direct, name: payload.customer_name || "" };
    const ref = String(payload.order_id || payload.channel_order_id || "").replace(/^#/, "").trim().toLowerCase();
    if (!ref) return { phone: null };
    const found = await OrderIndex.findOne({ userId: integration.userId, ref }).lean();
    return found ? { phone: found.phone, name: found.name } : { phone: null };
  }
  const paths = [mapping.phoneField, ...spec.fallbackPhones].filter(Boolean);
  for (const p of paths) {
    const phone = normalizePhone(getPath(payload, p));
    if (phone) return { phone };
  }
  return { phone: null };
}

/** Remember who an order belongs to, so later Shiprocket updates can reach them. */
async function rememberOrder(integration, payload) {
  const isOrder = integration.app === "shopify" ? Boolean(payload?.line_items || payload?.order_number) : integration.app === "woocommerce" ? Boolean(payload?.line_items || payload?.number) : false;
  if (!isOrder) return;
  const spec = STORE_APPS[integration.app];
  let phone = null;
  for (const p of spec.fallbackPhones) { phone = normalizePhone(getPath(payload, p)); if (phone) break; }
  if (!phone) return;
  const name = integration.app === "shopify"
    ? [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(" ")
    : [payload.billing?.first_name, payload.billing?.last_name].filter(Boolean).join(" ");
  const refs = [payload.name, payload.order_number, payload.number, payload.id].filter((v) => v !== undefined && v !== null && v !== "").map((v) => String(v).replace(/^#/, "").toLowerCase());
  for (const ref of new Set(refs)) {
    await OrderIndex.updateOne({ userId: integration.userId, ref }, { $set: { phone, name, createdAt: new Date() } }, { upsert: true }).catch(() => {});
  }
}

/** Runs the mappings for one verified webhook. Returns what happened per mapping (for tests and logs). */
async function processEvent(integration, events, payload) {
  const results = [];
  await rememberOrder(integration, payload);
  const due = integration.mappings.filter((m) => m.enabled && events.includes(m.event));
  for (const m of due) {
    const r = { mappingId: String(m._id), event: m.event };
    try {
      const template = await Template.findOne({ _id: m.templateId, createdBy: integration.userId }).lean();
      if (!template || template.status !== "APPROVED") throw new IntegrationError(409, "The template is no longer approved.");
      const { phone, name } = await phoneFor(integration, m, payload);
      if (!phone) throw new IntegrationError(422, "No customer phone number in this event.");
      const values = valuesFor(m, { ...payload, customer_name: payload.customer_name || name });
      r.to = phone;
      r.wamid = await sendTemplate({ userId: integration.userId, template, to: phone, variables: values, name });
      r.ok = true;
      await Integration.updateOne({ _id: integration._id, "mappings._id": m._id }, { $inc: { "mappings.$.sent": 1, "stats.sent": 1 }, $set: { "mappings.$.lastSentAt": new Date(), "mappings.$.lastError": "" } });
    } catch (error) {
      r.ok = false;
      r.error = error.message;
      await Integration.updateOne({ _id: integration._id, "mappings._id": m._id }, { $inc: { "mappings.$.failed": 1, "stats.failed": 1 }, $set: { "mappings.$.lastError": String(error.message).slice(0, 200), "stats.lastError": String(error.message).slice(0, 200) } });
    }
    results.push(r);
  }
  return results;
}

/**
 * Verifies an inbound store webhook. Returns { status, events, integration, payload } — the route
 * answers with `status` at once and runs processEvent afterwards.
 */
async function verifyWebhook(app, token, req) {
  if (!STORE_APPS[app] || !/^[a-f0-9]{48}$/.test(String(token || ""))) return { status: 404 };
  const integration = await Integration.findOne({ app, token }).select("+secret");
  if (!integration) return { status: 404 };
  const secret = integration.secret;
  const payload = req.body || {};
  let events = [];
  if (app === "shopify") {
    if (!safeEqual(req.get("x-shopify-hmac-sha256"), hmacBase64(secret, req.rawBody))) return { status: 401 };
    events = shopifyEvents(req.get("x-shopify-topic"), payload);
  } else if (app === "woocommerce") {
    const signature = req.get("x-wc-webhook-signature");
    // WooCommerce pings a new webhook with an unsigned form post before it is saved.
    if (!signature && (payload.webhook_id || req.is("application/x-www-form-urlencoded"))) return { status: 200, events: [] };
    if (!safeEqual(signature, hmacBase64(secret, req.rawBody))) return { status: 401 };
    events = wooEvents(req.get("x-wc-webhook-topic"), payload);
  } else if (app === "shiprocket") {
    if (!safeEqual(req.get("x-api-key"), secret)) return { status: 401 };
    events = shiprocketEvents(payload);
  }
  await Integration.updateOne({ _id: integration._id }, { $inc: { "stats.events": 1 }, $set: { "stats.lastEventAt": new Date() } });
  return { status: 200, events, integration, payload };
}

/* ---------- Google Sheets ---------- */
const sheetView = (s) => {
  const o = s.toObject ? s.toObject() : { ...s };
  return { ...o, needsMapping: !o.mapping?.phone };
};

async function listSheets(userId) {
  return (await Sheet.find({ userId }).sort({ createdAt: -1 }).lean()).map(sheetView);
}

async function createSheet(userId, body = {}) {
  if ((await Sheet.countDocuments({ userId })) >= 20) throw new IntegrationError(400, "Connect at most 20 sheets.");
  const doc = await Sheet.create({ userId, name: String(body.name || "").trim().slice(0, 80) || "My sheet", syncToken: randomHex(24) });
  return sheetView(doc);
}

function cleanWebAppUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) throw new IntegrationError(400, "Paste the Web App URL from Apps Script (https://script.google.com/macros/s/…/exec).");
  return u;
}

async function updateSheet(userId, sheetId, body = {}) {
  if (!isId(sheetId)) throw new IntegrationError(404, "Sheet not found.");
  const sheet = await Sheet.findOne({ _id: sheetId, userId });
  if (!sheet) throw new IntegrationError(404, "Sheet not found.");
  if (body.name !== undefined) sheet.name = String(body.name || "").trim().slice(0, 80) || sheet.name;
  if (body.webAppUrl !== undefined) sheet.webAppUrl = cleanWebAppUrl(body.webAppUrl);
  if (body.mapping !== undefined) {
    const m = body.mapping || {};
    const cols = new Set(sheet.headers);
    const col = (c) => (c && cols.has(c) ? c : "");
    if (!col(m.phone)) throw new IntegrationError(400, "Choose the column that has the phone number.");
    const fields = await Field.find({ userId }).select("key").lean();
    const custom = {};
    for (const f of fields) if (col(m.custom?.[f.key])) custom[f.key] = m.custom[f.key];
    sheet.mapping = { phone: m.phone, name: col(m.name), custom };
    sheet.markModified("mapping");
  }
  if (body.groupId !== undefined) {
    if (body.groupId && !(isId(body.groupId) && (await Group.exists({ _id: body.groupId, userId })))) throw new IntegrationError(400, "Choose one of your contact groups.");
    sheet.groupId = body.groupId || null;
  }
  await sheet.save();
  return sheetView(sheet);
}

async function deleteSheet(userId, sheetId) {
  if (!isId(sheetId)) throw new IntegrationError(404, "Sheet not found.");
  const r = await Sheet.deleteOne({ _id: sheetId, userId });
  if (!r.deletedCount) throw new IntegrationError(404, "Sheet not found.");
  return { deleted: true };
}

async function sheetByToken(userId, token) {
  const sheet = await Sheet.findOne({ userId, syncToken: String(token || "") });
  if (!sheet) throw new IntegrationError(404, "This sync token is not one of your connected sheets.");
  return sheet;
}

/** The sheet's Apps Script reports its header row. */
async function receiveHeaders(userId, body = {}) {
  const sheet = await sheetByToken(userId, body.sync_token);
  const headers = (Array.isArray(body.headers) ? body.headers : []).map((h) => String(h || "").trim().slice(0, 80)).filter(Boolean).slice(0, 60);
  if (!headers.length) throw new IntegrationError(400, "The first row of the sheet must hold column names.");
  sheet.headers = [...new Set(headers)];
  if (body.webAppUrl) sheet.webAppUrl = cleanWebAppUrl(body.webAppUrl);
  await sheet.save();
  return { headers: sheet.headers, needsMapping: !sheet.mapping?.phone };
}

/** Rows ({ column: value }) become contacts; existing contacts get the new values. */
async function receiveRows(userId, body = {}) {
  const sheet = await sheetByToken(userId, body.sync_token);
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 2000);
  if (!sheet.mapping?.phone) return { imported: 0, skipped: rows.length, needsMapping: true };
  const ops = [];
  let skipped = 0;
  for (const row of rows) {
    const phone = normalizePhone(row?.[sheet.mapping.phone]);
    if (!phone) { skipped += 1; continue; }
    const set = {};
    const name = sheet.mapping.name ? String(row[sheet.mapping.name] || "").trim().slice(0, 120) : "";
    if (name) set.name = name;
    for (const [key, col] of Object.entries(sheet.mapping.custom || {})) {
      const v = row?.[col];
      if (v !== undefined && v !== null && String(v).trim() !== "") set[`custom.${key}`] = String(v).trim().slice(0, 500);
    }
    const update = { $set: set, $setOnInsert: { source: "Imported", subscribed: true, ...(name ? {} : { name: "" }) } };
    if (!Object.keys(set).length) delete update.$set;
    if (sheet.groupId) update.$addToSet = { groups: sheet.groupId };
    ops.push({ updateOne: { filter: { userId, phone }, update, upsert: true } });
  }
  if (ops.length) await Contact.bulkWrite(ops, { ordered: false });
  await Sheet.updateOne({ _id: sheet._id }, { $inc: { rowsImported: ops.length }, $set: { lastSyncAt: new Date(), lastError: "" } });
  return { imported: ops.length, skipped };
}

/** "Sync Now": asks the sheet's deployed Web App to send every row again. */
async function syncSheet(userId, sheetId) {
  if (!isId(sheetId)) throw new IntegrationError(404, "Sheet not found.");
  const sheet = await Sheet.findOne({ _id: sheetId, userId });
  if (!sheet) throw new IntegrationError(404, "Sheet not found.");
  if (!sheet.webAppUrl) throw new IntegrationError(400, "Add the Web App URL first (Deploy → Web app in Apps Script).");
  try {
    const r = await axios.get(sheet.webAppUrl, { params: { action: "sync" }, timeout: 60000, maxRedirects: 5 });
    return { ok: true, result: typeof r.data === "object" ? r.data : String(r.data).slice(0, 200) };
  } catch (error) {
    const message = "The sheet did not answer. Open Apps Script and check the Web App is deployed with access for Anyone.";
    await Sheet.updateOne({ _id: sheet._id }, { $set: { lastError: message } });
    throw new IntegrationError(502, message);
  }
}

/* ---------- LeadSquared ---------- */
function lsqHost(host) {
  const h = String(host || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!/^api[\w-]*\.leadsquared\.com$/.test(h)) throw new IntegrationError(400, "Host looks like api-in21.leadsquared.com (LeadSquared → Settings → API and Webhooks).");
  return h;
}

async function connectLeadSquared(userId, body = {}) {
  const host = lsqHost(body.host);
  const accessKey = String(body.accessKey || "").trim();
  const secretKey = String(body.secretKey || "").trim();
  if (!accessKey || !secretKey) throw new IntegrationError(400, "Enter the Access Key and the Secret Key.");
  try {
    await axios.get(`https://${host}/v2/LeadManagement.svc/LeadsMetaData.Get`, { params: { accessKey, secretKey }, timeout: 15000 });
  } catch (error) {
    throw new IntegrationError(400, "LeadSquared did not accept these keys. Check the host, Access Key and Secret Key.");
  }
  // Saved through the document so the setter encrypts the keys.
  const doc = (await Integration.findOne({ userId, app: "leadsquared" }).select("+credentials")) || new Integration({ userId, app: "leadsquared", token: randomHex(24) });
  doc.label = host;
  doc.credentials = JSON.stringify({ host, accessKey, secretKey });
  await doc.save();
  return view(doc);
}

module.exports = {
  IntegrationError, STORE_APPS, getPath, shopifyEvents, wooEvents, shiprocketEvents, hmacBase64,
  listIntegrations, connectStore, disconnect, addMapping, updateMapping, removeMapping,
  verifyWebhook, processEvent, sendTemplate,
  listSheets, createSheet, updateSheet, deleteSheet, receiveHeaders, receiveRows, syncSheet,
  connectLeadSquared,
};
