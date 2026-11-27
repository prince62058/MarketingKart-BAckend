// CRM integrations: HubSpot and Zoho CRM (OAuth sign-in) and LeadSquared (API keys).
// Each connection imports CRM records as contacts (field mapping, optional group), pushes new
// WhatsApp contacts back to the CRM, and can send an approved template to records that are new
// in the CRM. A sync runs every 15 minutes and on "Sync now".
const crypto = require("crypto");
const axios = require("axios");
const Integration = require("../models/whatsappIntegrationModel");
const Template = require("../models/whatsappTemplateModel");
const Account = require("../models/whatsappAccountModel");
const Contact = require("../models/whatsappContactModel");
const Conversation = require("../models/whatsappConversationModel");
const Group = require("../models/whatsappContactGroupModel");
const Field = require("../models/whatsappContactFieldModel");
const { normalizePhone } = require("./whatsappContactService");
const integrations = require("./whatsappIntegrationService");

const { IntegrationError } = integrations;
/** HTTP goes through here so tests can stand in for HubSpot / Zoho / LeadSquared. */
const http = { request: (options) => axios({ timeout: 30000, ...options }) };

const publicBase = () => (process.env.PUBLIC_API_URL || "https://api.marketingkart.in").replace(/\/$/, "");
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ""));
const IMPORT_DAYS = 30;
const PAGES_PER_RUN = 20;
const PUSH_PER_RUN = 300;

const CRM_APPS = {
  hubspot: {
    name: "HubSpot",
    source: "HubSpot",
    oauthEnv: ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"],
    record: "contact",
    defaults: { phone: "phone", altPhone: "mobilephone", firstName: "firstname", lastName: "lastname" },
  },
  zoho: {
    name: "Zoho CRM",
    source: "Zoho CRM",
    oauthEnv: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"],
    record: "lead",
    defaults: { phone: "Phone", altPhone: "Mobile", firstName: "First_Name", lastName: "Last_Name" },
  },
  leadsquared: {
    name: "LeadSquared",
    source: "LeadSquared",
    record: "lead",
    defaults: { phone: "Phone", altPhone: "Mobile", firstName: "FirstName", lastName: "LastName" },
  },
};
const isCrm = (app) => Object.prototype.hasOwnProperty.call(CRM_APPS, app);
const ZOHO_ACCOUNTS = /^https:\/\/accounts\.zoho\.(com|in|eu|com\.au|jp|com\.cn|ca|sa|uk)$/;
const ZOHO_API = /^https:\/\/(www\.)?zohoapis\.(com|in|eu|com\.au|jp|com\.cn|ca|sa|uk)$/;

/* ---------- Signed OAuth state (no server-side session needed) ---------- */
function stateKey() {
  const k = process.env.JWT_SECRET || process.env.TOKEN_KEY || process.env.ENCRYPTION_KEY;
  if (!k) throw new IntegrationError(503, "The server has no signing key for sign-in.");
  return crypto.createHash("sha256").update(`crm-oauth:${k}`).digest();
}
function signState(data) {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", stateKey()).update(body).digest("base64url")}`;
}
function readState(state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", stateKey()).update(body).digest("base64url");
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data : null;
  } catch (_) {
    return null;
  }
}

/** Where the panel lives, so sign-in can return to it. Only our own sites and local dev. */
function panelOrigin(origin) {
  let u;
  try { u = new URL(String(origin || "")); } catch (_) { return null; }
  const extra = String(process.env.WHATSAPP_PANEL_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (extra.includes(u.origin)) return u.origin;
  if (["localhost", "127.0.0.1"].includes(u.hostname)) return u.origin;
  if (u.protocol === "https:" && /(^|\.)marketingkart\.(in|ai)$/.test(u.hostname)) return u.origin;
  return null;
}

const redirectUri = (app) => `${publicBase()}/api/whatsapp/integrations/${app}/oauth/callback`;
const envReady = (spec) => !spec.oauthEnv || spec.oauthEnv.every((k) => process.env[k]);

function oauthStart(userId, app, origin) {
  const spec = CRM_APPS[app];
  if (!spec?.oauthEnv) throw new IntegrationError(404, "Unknown app.");
  if (!envReady(spec)) {
    throw new IntegrationError(503, `${spec.name} sign-in is not set up on this server yet. The admin needs to add the ${spec.name} app keys (${spec.oauthEnv.join(", ")}).`);
  }
  const state = signState({ u: String(userId), a: app, o: panelOrigin(origin), n: crypto.randomBytes(8).toString("hex"), exp: Date.now() + 15 * 60000 });
  const q = new URLSearchParams({ client_id: process.env[spec.oauthEnv[0]], redirect_uri: redirectUri(app), state });
  if (app === "hubspot") {
    q.set("scope", "crm.objects.contacts.read crm.objects.contacts.write crm.schemas.contacts.read");
    return { url: `https://app.hubspot.com/oauth/authorize?${q}` };
  }
  q.set("scope", "ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.UPDATE,ZohoCRM.settings.fields.READ,ZohoCRM.org.READ");
  q.set("response_type", "code");
  q.set("access_type", "offline");
  q.set("prompt", "consent");
  return { url: `https://accounts.zoho.com/oauth/v2/auth?${q}` };
}

const form = (data) => new URLSearchParams(data).toString();
const formHeaders = { "content-type": "application/x-www-form-urlencoded" };

async function exchangeCode(app, code, query) {
  const spec = CRM_APPS[app];
  const base = { client_id: process.env[spec.oauthEnv[0]], client_secret: process.env[spec.oauthEnv[1]], redirect_uri: redirectUri(app), code, grant_type: "authorization_code" };
  if (app === "hubspot") {
    const r = await http.request({ method: "POST", url: "https://api.hubapi.com/oauth/v1/token", data: form(base), headers: formHeaders });
    const t = r.data || {};
    if (!t.access_token || !t.refresh_token) throw new Error("HubSpot gave no tokens.");
    let label = "";
    try {
      const info = await http.request({ method: "GET", url: `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(t.access_token)}` });
      label = info.data?.hub_domain || (info.data?.hub_id ? `Portal ${info.data.hub_id}` : "");
    } catch (_) {}
    return { creds: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 1800) * 1000 }, label };
  }
  const accounts = ZOHO_ACCOUNTS.test(String(query["accounts-server"] || "")) ? query["accounts-server"] : "https://accounts.zoho.com";
  const r = await http.request({ method: "POST", url: `${accounts}/oauth/v2/token`, data: form(base), headers: formHeaders });
  const t = r.data || {};
  if (!t.access_token || !t.refresh_token) throw new Error(t.error || "Zoho gave no tokens.");
  const apiDomain = ZOHO_API.test(String(t.api_domain || "")) ? t.api_domain : "https://www.zohoapis.com";
  let label = "";
  try {
    const org = await http.request({ method: "GET", url: `${apiDomain}/crm/v6/org`, headers: { authorization: `Zoho-oauthtoken ${t.access_token}` } });
    label = org.data?.org?.[0]?.company_name || "";
  } catch (_) {}
  return { creds: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000, accountsServer: accounts, apiDomain }, label };
}

const backTo = (origin, app, params) => (origin ? `${origin}/integrations/${app}?${new URLSearchParams(params)}` : null);

/**
 * The CRM sends the user back here after they approve (or refuse) access.
 * Returns { redirect } to the panel, or { html } when the panel's address is unknown.
 */
async function oauthCallback(app, query = {}) {
  const spec = CRM_APPS[app];
  const state = readState(query.state);
  const page = (title, text) => ({ html: `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px"><h2>${title}</h2><p>${text}</p></body>` });
  if (!spec?.oauthEnv || !state || state.a !== app) return page("Sign-in link expired", "Start the connection again from Integrations.");
  const fail = (message) => (backTo(state.o, app, { error: message }) ? { redirect: backTo(state.o, app, { error: message }) } : page(`${spec.name} not connected`, message));
  if (query.error) return fail(query.error === "access_denied" ? "Access was not approved." : `${spec.name} said: ${String(query.error).slice(0, 100)}`);
  if (!query.code) return fail("No sign-in code came back. Try again.");
  let result;
  try {
    result = await exchangeCode(app, String(query.code), query);
  } catch (error) {
    console.error(`[crm] ${app} code exchange failed:`, error.response?.data || error.message);
    return fail(`${spec.name} did not finish the sign-in. Try again.`);
  }
  const doc = (await Integration.findOne({ userId: state.u, app }).select("+credentials")) || new Integration({ userId: state.u, app, token: crypto.randomBytes(24).toString("hex") });
  doc.credentials = JSON.stringify(result.creds);
  doc.label = String(result.label || spec.name).slice(0, 200);
  doc.config = { ...freshConfig(doc.config), needsReconnect: false };
  doc.markModified("config");
  doc.stats.lastError = "";
  await doc.save();
  runSync(doc._id).catch((error) => console.error(`[crm] first ${app} sync failed:`, error.message));
  const ok = backTo(state.o, app, { connected: "1" });
  return ok ? { redirect: ok } : page(`${spec.name} connected`, "You can close this tab and go back to MarketingKart.");
}

/** Keeps the user's choices on reconnect; starts the clocks on a first connect. */
function freshConfig(old = {}) {
  const now = Date.now();
  return {
    paused: false,
    push: true,
    groupId: null,
    fieldMap: null,
    template: null,
    needsReconnect: false,
    ...old,
    connectedAt: old.connectedAt || new Date(now).toISOString(),
    cursor: old.cursor || new Date(now - IMPORT_DAYS * 86400000).toISOString(),
    pushCursor: old.pushCursor || new Date(now).toISOString(),
  };
}

/* ---------- Access tokens ---------- */
async function accessFor(doc) {
  const creds = JSON.parse(doc.credentials || "{}");
  if (doc.app === "leadsquared") return creds;
  if (creds.accessToken && creds.expiresAt - 60000 > Date.now()) return creds;
  const spec = CRM_APPS[doc.app];
  if (!envReady(spec)) throw new IntegrationError(503, `${spec.name} app keys are missing on the server.`);
  const data = { grant_type: "refresh_token", refresh_token: creds.refreshToken, client_id: process.env[spec.oauthEnv[0]], client_secret: process.env[spec.oauthEnv[1]] };
  let t;
  try {
    const url = doc.app === "hubspot" ? "https://api.hubapi.com/oauth/v1/token" : `${creds.accountsServer || "https://accounts.zoho.com"}/oauth/v2/token`;
    t = (await http.request({ method: "POST", url, data: form(data), headers: formHeaders })).data || {};
  } catch (error) {
    t = error.response?.data || {};
  }
  if (!t.access_token) {
    await Integration.updateOne({ _id: doc._id }, { $set: { "config.needsReconnect": true, "stats.lastError": `${spec.name} sign-in has expired. Reconnect to keep syncing.` } });
    throw new IntegrationError(409, `${spec.name} sign-in has expired. Reconnect ${spec.name}.`);
  }
  const next = { ...creds, accessToken: t.access_token, refreshToken: t.refresh_token || creds.refreshToken, expiresAt: Date.now() + (t.expires_in || 1800) * 1000 };
  // The schema setter encrypts on update queries too, so pass the plain JSON.
  await Integration.updateOne({ _id: doc._id }, { $set: { credentials: JSON.stringify(next) } });
  return next;
}

/* ---------- Per-CRM calls ---------- */
const hubHeaders = (c) => ({ authorization: `Bearer ${c.accessToken}`, "content-type": "application/json" });
const zohoHeaders = (c) => ({ authorization: `Zoho-oauthtoken ${c.accessToken}` });
const lsqUrl = (c, path) => `https://${c.host}/v2/LeadManagement.svc/${path}`;
const lsqKeys = (c) => ({ accessKey: c.accessKey, secretKey: c.secretKey });

const ADAPTERS = {
  hubspot: {
    async fields(c) {
      const r = await http.request({ method: "GET", url: "https://api.hubapi.com/crm/v3/properties/contacts", headers: hubHeaders(c) });
      return (r.data?.results || []).filter((p) => !p.hidden).map((p) => ({ name: p.name, label: p.label || p.name }));
    },
    async *pull(c, since, props) {
      let after;
      for (let page = 0; page < PAGES_PER_RUN; page += 1) {
        const body = {
          filterGroups: [{ filters: [{ propertyName: "lastmodifieddate", operator: "GTE", value: String(since.getTime()) }] }],
          sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
          properties: [...new Set([...props, "createdate", "lastmodifieddate"])],
          limit: 100,
          ...(after ? { after } : {}),
        };
        const r = await http.request({ method: "POST", url: "https://api.hubapi.com/crm/v3/objects/contacts/search", data: body, headers: hubHeaders(c) });
        for (const row of r.data?.results || []) {
          yield { id: row.id, props: row.properties || {}, createdAt: row.properties?.createdate || row.createdAt, modifiedAt: row.properties?.lastmodifieddate || row.updatedAt };
        }
        after = r.data?.paging?.next?.after;
        if (!after) return;
      }
    },
    async push(c, contact, map) {
      const tail = contact.phone.slice(-10);
      const found = await http.request({
        method: "POST", url: "https://api.hubapi.com/crm/v3/objects/contacts/search", headers: hubHeaders(c),
        data: { filterGroups: [map.phone, map.altPhone].filter(Boolean).map((p) => ({ filters: [{ propertyName: p, operator: "CONTAINS_TOKEN", value: `*${tail}` }] })), limit: 1 },
      });
      if (found.data?.total > 0) return "exists";
      const [first, ...rest] = String(contact.name || "").trim().split(/\s+/);
      const properties = { [map.phone || "phone"]: `+${contact.phone}` };
      if (first && map.firstName) properties[map.firstName] = first;
      if (rest.length && map.lastName) properties[map.lastName] = rest.join(" ");
      await http.request({ method: "POST", url: "https://api.hubapi.com/crm/v3/objects/contacts", headers: hubHeaders(c), data: { properties } });
      return "created";
    },
  },
  zoho: {
    async fields(c) {
      const r = await http.request({ method: "GET", url: `${c.apiDomain}/crm/v6/settings/fields`, params: { module: "Leads" }, headers: zohoHeaders(c) });
      return (r.data?.fields || []).map((f) => ({ name: f.api_name, label: f.field_label || f.api_name }));
    },
    async *pull(c, since, props) {
      const fields = [...new Set([...props, "Created_Time", "Modified_Time"])].slice(0, 50).join(",");
      for (let page = 1; page <= PAGES_PER_RUN; page += 1) {
        const r = await http.request({
          method: "GET", url: `${c.apiDomain}/crm/v6/Leads`, headers: { ...zohoHeaders(c), "If-Modified-Since": since.toISOString().replace(/\.\d{3}Z$/, "+00:00") },
          params: { fields, per_page: 200, page, sort_by: "Modified_Time", sort_order: "asc" },
          validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
        });
        if (r.status === 204 || r.status === 304) return;
        for (const row of r.data?.data || []) yield { id: row.id, props: row, createdAt: row.Created_Time, modifiedAt: row.Modified_Time };
        if (!r.data?.info?.more_records) return;
      }
    },
    async push(c, contact, map) {
      const [first, ...rest] = String(contact.name || "").trim().split(/\s+/);
      const lead = { [map.phone || "Phone"]: `+${contact.phone}`, Description: "Added from WhatsApp (MarketingKart)" };
      // Zoho needs a last name on every lead.
      lead[map.lastName || "Last_Name"] = rest.join(" ") || first || `WhatsApp ${contact.phone}`;
      if (rest.length && first && map.firstName) lead[map.firstName] = first;
      const r = await http.request({ method: "POST", url: `${c.apiDomain}/crm/v6/Leads/upsert`, headers: zohoHeaders(c), data: { data: [lead], duplicate_check_fields: [map.phone || "Phone"] } });
      const row = r.data?.data?.[0];
      if (row?.status !== "success") throw new Error(row?.message || "Zoho refused the lead.");
      return row.action === "update" ? "exists" : "created";
    },
  },
  leadsquared: {
    async fields(c) {
      const r = await http.request({ method: "GET", url: lsqUrl(c, "LeadsMetaData.Get"), params: lsqKeys(c) });
      return (Array.isArray(r.data) ? r.data : []).map((f) => ({ name: f.SchemaName, label: f.DisplayName || f.SchemaName }));
    },
    async *pull(c, since, props) {
      const fmt = (d) => d.toISOString().replace("T", " ").slice(0, 19);
      for (let page = 1; page <= PAGES_PER_RUN; page += 1) {
        const r = await http.request({
          method: "POST", url: lsqUrl(c, "Leads.RecentlyModified"), params: lsqKeys(c),
          data: { Parameter: { FromDate: fmt(since), ToDate: fmt(new Date()) }, Columns: { Include_CSV: [...new Set([...props, "CreatedOn", "ModifiedOn"])].join(",") }, Paging: { PageIndex: page, PageSize: 500 } },
        });
        const leads = r.data?.Leads || [];
        for (const lead of leads) {
          const p = Object.fromEntries((lead.LeadPropertyList || []).map((x) => [x.Attribute, x.Value]));
          const utc = (v) => (v ? `${String(v).replace(" ", "T")}Z` : null);
          yield { id: p.ProspectID, props: p, createdAt: utc(p.CreatedOn), modifiedAt: utc(p.ModifiedOn) };
        }
        if (leads.length < 500) return;
      }
    },
    async push(c, contact, map) {
      const [first, ...rest] = String(contact.name || "").trim().split(/\s+/);
      const attrs = [{ Attribute: map.phone || "Phone", Value: `+${contact.phone}` }, { Attribute: "Source", Value: "WhatsApp" }, { Attribute: "SearchBy", Value: map.phone || "Phone" }];
      if (first) attrs.push({ Attribute: map.firstName || "FirstName", Value: first });
      if (rest.length) attrs.push({ Attribute: map.lastName || "LastName", Value: rest.join(" ") });
      const r = await http.request({ method: "POST", url: lsqUrl(c, "Lead.Capture"), params: lsqKeys(c), data: attrs });
      if (r.data?.Status && r.data.Status !== "Success") throw new Error(r.data?.ExceptionMessage || "LeadSquared refused the lead.");
      return "created";
    },
  },
};

/* ---------- Settings ---------- */
const mapOf = (doc) => ({ ...CRM_APPS[doc.app].defaults, custom: {}, ...(doc.config?.fieldMap || {}) });

async function loadCrm(userId, app, withCreds = false) {
  if (!isCrm(app)) throw new IntegrationError(404, "Unknown app.");
  const q = Integration.findOne({ userId, app });
  const doc = await (withCreds ? q.select("+credentials") : q);
  if (!doc) throw new IntegrationError(409, `Connect ${CRM_APPS[app].name} first.`);
  return doc;
}

function crmView(doc) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  delete o.secret;
  delete o.credentials;
  delete o.syncLockUntil;
  return { ...o, config: { ...freshConfig(o.config), fieldMap: mapOf(o) } };
}

/** The CRM's own field list, for the mapping screen. */
async function crmFields(userId, app) {
  const doc = await loadCrm(userId, app, true);
  try {
    const fields = await ADAPTERS[app].fields(await accessFor(doc));
    return fields.sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(502, `${CRM_APPS[app].name} did not return its fields. Try again.`);
  }
}

async function getCrm(userId, app) {
  return crmView(await loadCrm(userId, app));
}

const cleanProp = (v) => String(v || "").trim().slice(0, 100);

async function updateCrm(userId, app, body = {}) {
  const doc = await loadCrm(userId, app);
  const config = freshConfig(doc.config);
  if (typeof body.paused === "boolean") config.paused = body.paused;
  if (typeof body.push === "boolean") config.push = body.push;
  if (body.groupId !== undefined) {
    if (body.groupId && !(isId(body.groupId) && (await Group.exists({ _id: body.groupId, userId })))) throw new IntegrationError(400, "Choose one of your contact groups.");
    config.groupId = body.groupId || null;
  }
  if (body.fieldMap !== undefined) {
    const m = body.fieldMap || {};
    if (!cleanProp(m.phone)) throw new IntegrationError(400, "Map at least one field to Phone Number.");
    const keys = new Set((await Field.find({ userId }).select("key").lean()).map((f) => f.key));
    const custom = {};
    for (const [k, v] of Object.entries(m.custom || {})) if (keys.has(k) && cleanProp(v)) custom[k] = cleanProp(v);
    config.fieldMap = { phone: cleanProp(m.phone), altPhone: cleanProp(m.altPhone), firstName: cleanProp(m.firstName), lastName: cleanProp(m.lastName), custom };
  }
  if (body.template !== undefined) {
    const t = body.template;
    if (!t || !t.templateId) config.template = null;
    else {
      if (!isId(t.templateId)) throw new IntegrationError(400, "Choose an approved template.");
      const tpl = await Template.findOne({ _id: t.templateId, createdBy: userId, disable: { $ne: true } }).select("status bodyText components").lean();
      if (!tpl) throw new IntegrationError(400, "Choose one of your templates.");
      if (tpl.status !== "APPROVED") throw new IntegrationError(400, "That template is not approved by Meta yet.");
      const variables = {};
      for (const [k, v] of Object.entries(t.variables || {})) {
        const key = String(k).replace(/[{}\s]/g, "").slice(0, 60);
        if (!key) continue;
        if (v && typeof v === "object" && "text" in v) variables[key] = { text: String(v.text || "").slice(0, 500) };
        else if (typeof v === "string" && v.trim()) variables[key] = cleanProp(v);
      }
      const needed = templateVars(tpl);
      const missing = needed.filter((k) => !variables[k] || (typeof variables[k] === "object" && !variables[k].text));
      if (missing.length) throw new IntegrationError(400, `Map a ${CRM_APPS[app].name} field for every template variable (${missing.map((k) => `{{${k}}}`).join(", ")}).`);
      config.template = { templateId: String(tpl._id), variables, enabled: t.enabled !== false };
    }
  }
  doc.config = config;
  doc.markModified("config");
  await doc.save();
  return crmView(doc);
}

/** Body and header {{variables}} of a template, in order. */
function templateVars(tpl) {
  const texts = [tpl.bodyText, ...(tpl.components || []).filter((c) => ["BODY", "HEADER"].includes(String(c.type).toUpperCase()) && c.text).map((c) => c.text)];
  const out = [];
  for (const t of texts) for (const m of String(t || "").matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

async function disconnectCrm(userId, app) {
  const doc = await loadCrm(userId, app, true);
  if (app !== "leadsquared") {
    // Best effort: tell the CRM we no longer need access.
    try {
      const c = JSON.parse(doc.credentials || "{}");
      if (app === "hubspot" && c.refreshToken) await http.request({ method: "DELETE", url: `https://api.hubapi.com/oauth/v1/refresh-tokens/${encodeURIComponent(c.refreshToken)}` });
      if (app === "zoho" && c.refreshToken) await http.request({ method: "POST", url: `${c.accountsServer || "https://accounts.zoho.com"}/oauth/v2/token/revoke`, data: form({ token: c.refreshToken }), headers: formHeaders });
    } catch (_) {}
  }
  await Integration.deleteOne({ _id: doc._id });
  return { disconnected: true };
}

/* ---------- Sync ---------- */
function recordValue(record, path) {
  const v = record.props?.[path];
  return v === undefined || v === null ? "" : String(v).trim();
}

/** Import: CRM records → contacts. Returns which records were new contacts. */
async function importRecords(doc, creds, report) {
  const map = mapOf(doc);
  const since = new Date(doc.config.cursor || Date.now() - IMPORT_DAYS * 86400000);
  const props = [map.phone, map.altPhone, map.firstName, map.lastName, ...Object.values(map.custom || {}), ...Object.values(doc.config.template?.variables || {}).filter((v) => typeof v === "string")].filter(Boolean);
  const source = CRM_APPS[doc.app].source;
  let cursor = since;
  let batch = [];
  const fresh = [];
  const flush = async () => {
    if (!batch.length) return;
    const ops = batch.map(({ phone, set, name }) => {
      const update = { $setOnInsert: { source, subscribed: true, name: name || "" } };
      if (Object.keys(set).length) update.$set = set;
      if (doc.config.groupId) update.$addToSet = { groups: doc.config.groupId };
      return { updateOne: { filter: { userId: doc.userId, phone }, update, upsert: true } };
    });
    const result = await Contact.bulkWrite(ops, { ordered: false });
    const added = Object.keys(result.upsertedIds || {});
    for (const index of added) fresh.push(batch[Number(index)]);
    report.imported += added.length;
    report.updated += ops.length - added.length;
    batch = [];
  };
  const seen = new Set();
  for await (const record of ADAPTERS[doc.app].pull(creds, since, props)) {
    const modified = record.modifiedAt ? new Date(record.modifiedAt) : null;
    if (modified && !Number.isNaN(modified.getTime()) && modified > cursor) cursor = modified;
    const phone = normalizePhone(recordValue(record, map.phone) || recordValue(record, map.altPhone));
    if (!phone) { report.skipped += 1; continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    const name = [recordValue(record, map.firstName), recordValue(record, map.lastName)].filter(Boolean).join(" ").slice(0, 120);
    const set = {};
    for (const [key, prop] of Object.entries(map.custom || {})) {
      const v = recordValue(record, prop);
      if (v) set[`custom.${key}`] = v.slice(0, 500);
    }
    batch.push({ phone, set, name, record });
    if (batch.length >= 200) await flush();
  }
  await flush();
  return { fresh, cursor };
}

/** Sends the mapped template to records created in the CRM after it was connected. */
async function welcomeNew(doc, fresh, report) {
  const rule = doc.config.template;
  if (!rule?.enabled || !rule.templateId || !fresh.length) return;
  const template = await Template.findOne({ _id: rule.templateId, createdBy: doc.userId }).lean();
  if (!template || template.status !== "APPROVED") { report.errors.push("The welcome template is no longer approved."); return; }
  const connectedAt = new Date(doc.config.connectedAt || 0);
  for (const item of fresh) {
    const created = item.record.createdAt ? new Date(item.record.createdAt) : null;
    if (!created || Number.isNaN(created.getTime()) || created < connectedAt) continue;
    const values = {};
    for (const [key, rule2] of Object.entries(rule.variables || {})) {
      const v = typeof rule2 === "object" ? rule2.text : recordValue(item.record, rule2);
      if (v) values[key] = String(v).slice(0, 500);
    }
    try {
      await integrations.sendTemplate({ userId: doc.userId, template, to: item.phone, variables: values, name: item.name });
      report.sent += 1;
    } catch (error) {
      report.failed += 1;
      report.errors.push(String(error.message).slice(0, 200));
    }
  }
}

/** Push: contacts and new chats on WhatsApp since the last run → CRM. */
async function pushNew(doc, creds, report) {
  const map = mapOf(doc);
  const since = new Date(doc.config.pushCursor || doc.config.connectedAt || Date.now());
  const until = new Date();
  const source = CRM_APPS[doc.app].source;
  const contacts = await Contact.find({ userId: doc.userId, source: { $ne: source }, createdAt: { $gt: since, $lte: until } }).sort({ createdAt: 1 }).limit(PUSH_PER_RUN).select("phone name createdAt").lean();
  const numbers = (await Account.find({ userId: doc.userId }).select("phoneNumberId").lean()).map((a) => a.phoneNumberId).filter(Boolean);
  const chats = numbers.length
    ? await Conversation.find({ phoneNumberId: { $in: numbers }, createdAt: { $gt: since, $lte: until } }).sort({ createdAt: 1 }).limit(PUSH_PER_RUN).select("customerPhone customerName createdAt").lean()
    : [];
  const items = [
    ...contacts.map((c) => ({ phone: c.phone, name: c.name, createdAt: c.createdAt })),
    ...chats.map((c) => ({ phone: normalizePhone(c.customerPhone), name: c.customerName === "Unknown" ? "" : c.customerName, createdAt: c.createdAt })),
  ].filter((i) => i.phone).sort((a, b) => a.createdAt - b.createdAt).slice(0, PUSH_PER_RUN);
  // Numbers that came from this CRM are not sent back to it.
  const fromCrm = new Set((await Contact.find({ userId: doc.userId, source, phone: { $in: items.map((i) => i.phone) } }).select("phone").lean()).map((c) => c.phone));
  const done = new Set();
  let cursor = until;
  for (const item of items) {
    if (done.has(item.phone) || fromCrm.has(item.phone)) continue;
    done.add(item.phone);
    try {
      const r = await ADAPTERS[doc.app].push(creds, item, map);
      if (r === "created") report.pushed += 1;
    } catch (error) {
      report.pushFailed += 1;
      report.errors.push(`Push ${item.phone}: ${String(error.response?.data?.message || error.message).slice(0, 150)}`);
    }
  }
  if (items.length >= PUSH_PER_RUN) cursor = items[items.length - 1].createdAt;
  return cursor;
}

/** One sync of one connection. Returns what it did; never runs twice at once for a connection. */
async function runSync(integrationId) {
  const now = new Date();
  const doc = await Integration.findOneAndUpdate(
    { _id: integrationId, app: { $in: Object.keys(CRM_APPS) }, $or: [{ syncLockUntil: null }, { syncLockUntil: { $lt: now } }] },
    { $set: { syncLockUntil: new Date(now.getTime() + 10 * 60000) } },
    { new: true }
  ).select("+credentials");
  if (!doc) return { busy: true };
  const report = { imported: 0, updated: 0, skipped: 0, sent: 0, failed: 0, pushed: 0, pushFailed: 0, errors: [] };
  const set = { syncLockUntil: null, "stats.lastSyncAt": new Date() };
  try {
    doc.config = freshConfig(doc.config);
    if (doc.config.paused) return { paused: true };
    const creds = await accessFor(doc);
    const { fresh, cursor } = await importRecords(doc, creds, report);
    set["config.cursor"] = cursor.toISOString();
    set["config.connectedAt"] = doc.config.connectedAt;
    await welcomeNew(doc, fresh, report);
    if (doc.config.push) set["config.pushCursor"] = (await pushNew(doc, creds, report)).toISOString();
    set["stats.lastError"] = report.errors[0] || "";
    return report;
  } catch (error) {
    const message = error instanceof IntegrationError ? error.message : `${CRM_APPS[doc.app].name} sync failed. ${error.response?.status === 401 ? "Reconnect the app." : "It will retry in 15 minutes."}`;
    if (!(error instanceof IntegrationError)) console.error(`[crm] ${doc.app} sync failed:`, error.response?.data || error.message);
    set["stats.lastError"] = message;
    report.error = message;
    return report;
  } finally {
    const inc = { "stats.imported": report.imported, "stats.sent": report.sent, "stats.failed": report.failed, "stats.pushed": report.pushed, "stats.pushFailed": report.pushFailed };
    await Integration.updateOne({ _id: doc._id }, { $set: set, $inc: inc }).catch(() => {});
  }
}

async function syncNow(userId, app) {
  const doc = await loadCrm(userId, app);
  if (doc.config?.paused) throw new IntegrationError(409, "Sync is paused. Resume it first.");
  const r = await runSync(doc._id);
  if (r.busy) throw new IntegrationError(409, "Still processing — check back shortly.");
  if (r.error) throw new IntegrationError(502, r.error);
  return r;
}

/** Every 15 minutes: sync every CRM connection that is not paused. */
let scheduled = false;
function startScheduler() {
  if (scheduled) return;
  scheduled = true;
  const cron = require("node-cron");
  cron.schedule("*/15 * * * *", async () => {
    const rows = await Integration.find({ app: { $in: Object.keys(CRM_APPS) }, "config.paused": { $ne: true }, "config.needsReconnect": { $ne: true } }).select("_id").lean().catch(() => []);
    for (const row of rows) await runSync(row._id).catch((error) => console.error("[crm] scheduled sync failed:", error.message));
  });
}

/** LeadSquared connect keeps its key check; this sets up the sync clocks on top. */
async function afterLeadSquaredConnect(userId) {
  const doc = await Integration.findOne({ userId, app: "leadsquared" });
  if (!doc) return null;
  doc.config = freshConfig(doc.config);
  doc.markModified("config");
  await doc.save();
  runSync(doc._id).catch(() => {});
  return crmView(doc);
}

module.exports = {
  CRM_APPS, isCrm, http, signState, readState, panelOrigin, redirectUri, envReady,
  oauthStart, oauthCallback, crmFields, getCrm, updateCrm, disconnectCrm, runSync, syncNow, startScheduler,
  afterLeadSquaredConnect, templateVars,
};
