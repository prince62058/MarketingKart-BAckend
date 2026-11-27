// CRM integrations (HubSpot, Zoho CRM, LeadSquared) against the real app and a throwaway mongod.
// The CRMs are replaced by a fake HTTP layer that answers like their APIs and records each call.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let crm;
let alice;
let aliceToken;
let bobToken;
let template;
let group;
const sent = [];
const calls = [];
const crmState = { hubContacts: [], zohoLeads: [], lsqLeads: [], refreshFails: false };

function fakeCrm(options) {
  const { method, url } = options;
  calls.push({ method, url, data: options.data, params: options.params, headers: options.headers });
  const ok = (data, status = 200) => Promise.resolve({ status, data });
  if (url === "https://api.hubapi.com/oauth/v1/token") {
    const body = new URLSearchParams(options.data);
    if (body.get("grant_type") === "refresh_token" && crmState.refreshFails) return Promise.reject(Object.assign(new Error("400"), { response: { status: 400, data: { status: "BAD_REFRESH_TOKEN" } } }));
    return ok({ access_token: `hub-at-${calls.length}`, refresh_token: "hub-rt", expires_in: 1800 });
  }
  if (url.startsWith("https://api.hubapi.com/oauth/v1/access-tokens/")) return ok({ hub_id: 42, hub_domain: "demo.hubspot.com" });
  if (url === "https://api.hubapi.com/crm/v3/properties/contacts") return ok({ results: [{ name: "phone", label: "Phone Number" }, { name: "city", label: "City" }, { name: "secret_x", label: "Hidden", hidden: true }] });
  if (url === "https://api.hubapi.com/crm/v3/objects/contacts/search") {
    if (options.data.filterGroups?.[0]?.filters?.[0]?.operator === "CONTAINS_TOKEN") {
      const tail = options.data.filterGroups[0].filters[0].value.slice(1);
      return ok({ total: crmState.hubContacts.filter((c) => String(c.properties.phone || "").replace(/\D/g, "").endsWith(tail)).length });
    }
    return ok({ results: crmState.hubContacts });
  }
  if (url === "https://api.hubapi.com/crm/v3/objects/contacts" && method === "POST") return ok({ id: "new" }, 201);
  if (url.startsWith("https://api.hubapi.com/oauth/v1/refresh-tokens/")) return ok({}, 204);
  if (url === "https://accounts.zoho.in/oauth/v2/token") return ok({ access_token: "zoho-at", refresh_token: "zoho-rt", expires_in: 3600, api_domain: "https://www.zohoapis.in" });
  if (url === "https://www.zohoapis.in/crm/v6/org") return ok({ org: [{ company_name: "Demo Pvt Ltd" }] });
  if (url === "https://www.zohoapis.in/crm/v6/Leads") return crmState.zohoLeads.length ? ok({ data: crmState.zohoLeads, info: { more_records: false } }) : ok(undefined, 304);
  if (url === "https://www.zohoapis.in/crm/v6/Leads/upsert") return ok({ data: [{ status: "success", action: "insert" }] });
  if (url.endsWith("/LeadsMetaData.Get")) return ok([{ SchemaName: "Phone", DisplayName: "Phone" }]);
  if (url.endsWith("/Leads.RecentlyModified")) return ok({ Leads: crmState.lsqLeads });
  if (url.endsWith("/Lead.Capture")) return ok({ Status: "Success" });
  return Promise.reject(new Error(`unexpected ${method} ${url}`));
}

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness({ env: { WHATSAPP_TOKEN_ENCRYPTION_KEY: "ef".repeat(32), PUBLIC_API_URL: "https://api.example.test" } });
  crm = require("../src/services/whatsappCrmService");
  crm.http.request = fakeCrm;
  require("../src/services/whatsappIntegrationService");
  // LeadSquared's key check uses axios directly.
  const axios = require("axios");
  axios.get = (url, opts) => fakeCrm({ method: "GET", url, ...opts });
  const cloud = require("../src/services/whatsappCloudApiService");
  cloud.sendTemplateMessage = async (to, name, language, components) => {
    sent.push({ to, name, components });
    return { messages: [{ id: `wamid.${sent.length}` }] };
  };
  const fixtures = require("./helpers/securityFixtures");
  for (const name of ["whatsappIntegration", "whatsappContact"]) await require("mongoose").models[name]?.syncIndexes();
  alice = await fixtures.makeUser({ name: "Alice", whatsappWallet: 100 });
  aliceToken = fixtures.tokenFor(alice);
  bobToken = fixtures.tokenFor(await fixtures.makeUser({ name: "Bob" }));
  await require("../src/models/whatsappAccountModel").create({ userId: alice._id, phoneNumberId: "pn-c", wabaId: "waba-c", phoneNumber: "+91 91111 55017", accessToken: "t", status: "CONNECTED" });
  template = await require("../src/models/whatsappTemplateModel").create({
    name: "welcome_lead", category: "UTILITY", language: "en", status: "APPROVED", createdBy: alice._id,
    bodyText: "Hi {{1}}, thanks for your interest.",
    components: [{ type: "BODY", text: "Hi {{1}}, thanks for your interest.", example: { body_text: [["Asha"]] } }],
  });
  group = await require("../src/models/whatsappContactGroupModel").create({ userId: alice._id, name: "CRM leads" });
  await require("../src/models/whatsappContactFieldModel").create({ userId: alice._id, key: "city", name: "City", type: "Text" });
});

after(async () => {
  if (h) await h.close();
});

const settle = () => new Promise((r) => setTimeout(r, 300));
const Integration = () => require("../src/models/whatsappIntegrationModel");
const Contact = () => require("../src/models/whatsappContactModel");

test("sign-in returns only to our own sites", { skip }, () => {
  assert.equal(crm.panelOrigin("https://wa.marketingkart.in/x"), "https://wa.marketingkart.in");
  assert.equal(crm.panelOrigin("http://localhost:5174"), "http://localhost:5174");
  assert.equal(crm.panelOrigin("https://marketingkart.in.evil.com"), null);
  assert.equal(crm.panelOrigin("http://wa.marketingkart.in"), null);
  assert.equal(crm.readState("abc.def"), null);
  const s = crm.signState({ u: "1", a: "hubspot", exp: Date.now() + 1000 });
  assert.equal(crm.readState(s).a, "hubspot");
  assert.equal(crm.readState(`${s}x`), null);
  assert.equal(crm.readState(crm.signState({ u: "1", a: "hubspot", exp: Date.now() - 1 })), null);
});

test("without app keys the server says what is missing", { skip }, async () => {
  delete process.env.HUBSPOT_CLIENT_ID;
  const r = await h.call("POST", "/api/whatsapp/integrations/hubspot/oauth/start", { token: aliceToken, body: {} });
  assert.equal(r.status, 503);
  assert.match(r.body.message, /HUBSPOT_CLIENT_ID/);
  const list = await h.call("GET", "/api/whatsapp/integrations", { token: aliceToken });
  assert.equal(list.body.data.hubspot.available, false);
});

test("HubSpot: sign-in, mapping, import with a welcome template, and push back", { skip }, async () => {
  process.env.HUBSPOT_CLIENT_ID = "hub-client";
  process.env.HUBSPOT_CLIENT_SECRET = "hub-secret";
  const start = await h.call("POST", "/api/whatsapp/integrations/hubspot/oauth/start", { token: aliceToken, body: { origin: "http://localhost:5174" } });
  assert.equal(start.status, 200);
  const url = new URL(start.body.data.url);
  assert.equal(url.host, "app.hubspot.com");
  assert.equal(url.searchParams.get("redirect_uri"), "https://api.example.test/api/whatsapp/integrations/hubspot/oauth/callback");
  const state = url.searchParams.get("state");

  // A forged or missing state never connects anything.
  const forged = await crm.oauthCallback("hubspot", { code: "c", state: "x.y" });
  assert.match(forged.html, /expired/);
  const denied = await crm.oauthCallback("hubspot", { error: "access_denied", state });
  assert.match(denied.redirect, /^http:\/\/localhost:5174\/integrations\/hubspot\?error=/);

  const ok = await crm.oauthCallback("hubspot", { code: "auth-code", state });
  assert.equal(ok.redirect, "http://localhost:5174/integrations/hubspot?connected=1");
  await settle();
  const saved = await Integration().findOne({ userId: alice._id, app: "hubspot" }).select("+credentials").lean();
  assert.equal(saved.label, "demo.hubspot.com");
  assert.ok(!saved.credentials.includes("hub-rt"), "tokens are encrypted at rest");

  const view = await h.call("GET", "/api/whatsapp/integrations/hubspot/crm", { token: aliceToken });
  assert.equal(view.status, 200);
  assert.equal(view.body.data.credentials, undefined);
  assert.equal(view.body.data.config.fieldMap.phone, "phone");
  assert.equal((await h.call("GET", "/api/whatsapp/integrations/hubspot/crm", { token: bobToken })).status, 409);

  const fields = await h.call("GET", "/api/whatsapp/integrations/hubspot/fields", { token: aliceToken });
  assert.deepEqual(fields.body.data.map((f) => f.name), ["city", "phone"]);

  const noPhone = await h.call("PUT", "/api/whatsapp/integrations/hubspot/crm", { token: aliceToken, body: { fieldMap: { phone: "" } } });
  assert.equal(noPhone.status, 400);
  assert.match(noPhone.body.message, /Phone Number/);
  const noVars = await h.call("PUT", "/api/whatsapp/integrations/hubspot/crm", { token: aliceToken, body: { template: { templateId: String(template._id), variables: {} } } });
  assert.equal(noVars.status, 400);
  assert.match(noVars.body.message, /\{\{1\}\}/);
  const put = await h.call("PUT", "/api/whatsapp/integrations/hubspot/crm", {
    token: aliceToken,
    body: { groupId: String(group._id), fieldMap: { phone: "phone", firstName: "firstname", lastName: "lastname", custom: { city: "city", nope: "x" } }, template: { templateId: String(template._id), variables: { 1: "firstname" } } },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.data.config.fieldMap.custom, { city: "city" });

  const later = new Date(Date.now() + 60000).toISOString();
  const old = new Date(Date.now() - 5 * 86400000).toISOString();
  crmState.hubContacts = [
    { id: "1", properties: { phone: "+91 98765 00021", firstname: "Asha", lastname: "Rao", city: "Pune", createdate: later, lastmodifieddate: later } },
    { id: "2", properties: { phone: "98765 00022", firstname: "Old", createdate: old, lastmodifieddate: old } },
    { id: "3", properties: { firstname: "No phone", createdate: later, lastmodifieddate: later } },
  ];
  // A contact added on WhatsApp after connecting is pushed to HubSpot.
  await Contact().create({ userId: alice._id, phone: "919876500099", name: "Ravi Kumar", source: "Direct" });

  const r = await h.call("POST", "/api/whatsapp/integrations/hubspot/sync", { token: aliceToken, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.imported, 2);
  assert.equal(r.body.data.skipped, 1);
  assert.equal(r.body.data.sent, 1, "only the record created after connecting gets the template");
  assert.equal(r.body.data.pushed, 1);
  const asha = await Contact().findOne({ userId: alice._id, phone: "919876500021" }).lean();
  assert.equal(asha.name, "Asha Rao");
  assert.equal(asha.source, "HubSpot");
  assert.equal(asha.custom.city, "Pune");
  assert.deepEqual(asha.groups.map(String), [String(group._id)]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "919876500021");
  assert.equal(sent[0].components[0].parameters[0].text, "Asha");
  const created = calls.filter((c) => c.url === "https://api.hubapi.com/crm/v3/objects/contacts");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].data.properties, { phone: "+919876500099", firstname: "Ravi", lastname: "Kumar" });

  // A second run imports again but neither re-sends the template nor pushes the same contact.
  const r2 = await h.call("POST", "/api/whatsapp/integrations/hubspot/sync", { token: aliceToken, body: {} });
  assert.equal(r2.body.data.sent, 0);
  assert.equal(r2.body.data.pushed, 0);

  const paused = await h.call("PUT", "/api/whatsapp/integrations/hubspot/crm", { token: aliceToken, body: { paused: true } });
  assert.equal(paused.body.data.config.paused, true);
  assert.equal((await h.call("POST", "/api/whatsapp/integrations/hubspot/sync", { token: aliceToken, body: {} })).status, 409);
  await h.call("PUT", "/api/whatsapp/integrations/hubspot/crm", { token: aliceToken, body: { paused: false } });
});

test("HubSpot: an expired token is refreshed, and a refused refresh asks to reconnect", { skip }, async () => {
  const doc = await Integration().findOne({ userId: alice._id, app: "hubspot" }).select("+credentials");
  doc.credentials = JSON.stringify({ ...JSON.parse(doc.credentials), expiresAt: Date.now() - 1000 });
  await doc.save();
  const before = calls.length;
  const ok = await h.call("POST", "/api/whatsapp/integrations/hubspot/sync", { token: aliceToken, body: {} });
  assert.equal(ok.status, 200);
  assert.ok(calls.slice(before).some((c) => c.url.endsWith("/oauth/v1/token") && new URLSearchParams(c.data).get("grant_type") === "refresh_token"));

  const again = await Integration().findOne({ userId: alice._id, app: "hubspot" }).select("+credentials");
  again.credentials = JSON.stringify({ ...JSON.parse(again.credentials), expiresAt: Date.now() - 1000 });
  await again.save();
  crmState.refreshFails = true;
  const bad = await h.call("POST", "/api/whatsapp/integrations/hubspot/sync", { token: aliceToken, body: {} });
  crmState.refreshFails = false;
  assert.equal(bad.status, 502);
  assert.match(bad.body.message, /Reconnect/);
  const view = await h.call("GET", "/api/whatsapp/integrations/hubspot/crm", { token: aliceToken });
  assert.equal(view.body.data.config.needsReconnect, true);
});

test("one sync at a time per connection", { skip }, async () => {
  const doc = await Integration().findOne({ userId: alice._id, app: "hubspot" });
  await Integration().updateOne({ _id: doc._id }, { $set: { syncLockUntil: new Date(Date.now() + 60000) } });
  assert.deepEqual(await crm.runSync(doc._id), { busy: true });
  const r = await h.call("POST", "/api/whatsapp/integrations/hubspot/sync", { token: aliceToken, body: {} });
  assert.equal(r.status, 409);
  await Integration().updateOne({ _id: doc._id }, { $set: { syncLockUntil: null } });
});

test("Zoho CRM: regional sign-in, leads import, and new contacts upserted as leads", { skip }, async () => {
  process.env.ZOHO_CLIENT_ID = "zoho-client";
  process.env.ZOHO_CLIENT_SECRET = "zoho-secret";
  const start = await h.call("POST", "/api/whatsapp/integrations/zoho/oauth/start", { token: aliceToken, body: { origin: "https://wa.marketingkart.in" } });
  const url = new URL(start.body.data.url);
  assert.equal(url.searchParams.get("access_type"), "offline");
  // A made-up accounts server is ignored (it would receive our client secret).
  const evil = await crm.oauthCallback("zoho", { code: "c", state: url.searchParams.get("state"), "accounts-server": "https://evil.example" });
  assert.match(evil.redirect, /error=/);
  const ok = await crm.oauthCallback("zoho", { code: "c", state: url.searchParams.get("state"), "accounts-server": "https://accounts.zoho.in" });
  assert.equal(ok.redirect, "https://wa.marketingkart.in/integrations/zoho?connected=1");
  await settle();
  const saved = await Integration().findOne({ userId: alice._id, app: "zoho" }).lean();
  assert.equal(saved.label, "Demo Pvt Ltd");

  crmState.zohoLeads = [{ id: "z1", Phone: "+91 98765 00031", First_Name: "Meera", Last_Name: "Shah", Created_Time: new Date().toISOString(), Modified_Time: new Date().toISOString() }];
  await Contact().create({ userId: alice._id, phone: "919876500098", name: "Solo", source: "Direct" });
  const r = await h.call("POST", "/api/whatsapp/integrations/zoho/sync", { token: aliceToken, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.imported, 1);
  assert.equal((await Contact().findOne({ userId: alice._id, phone: "919876500031" }).lean()).source, "Zoho CRM");
  const upserts = calls.filter((c) => c.url.endsWith("/crm/v6/Leads/upsert"));
  assert.ok(upserts.length >= 1);
  const solo = upserts.map((c) => c.data.data[0]).find((l) => l.Phone === "+919876500098");
  assert.equal(solo.Last_Name, "Solo", "Zoho needs a last name, so a one-word name is used for it");
  assert.ok(!upserts.some((c) => c.data.data[0].Phone === "+919876500031"), "leads from Zoho are not sent back");

  const gone = await h.call("DELETE", "/api/whatsapp/integrations/zoho", { token: aliceToken });
  assert.equal(gone.status, 200);
  assert.ok(calls.some((c) => c.url === "https://accounts.zoho.in/oauth/v2/token/revoke"));
});

test("LeadSquared: connect, import with mapping, and push via Lead.Capture", { skip }, async () => {
  const c = await h.call("POST", "/api/whatsapp/integrations/leadsquared/connect", { token: aliceToken, body: { host: "api-in21.leadsquared.com", accessKey: "u$rkey", secretKey: "secret" } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.data.config.fieldMap.phone, "Phone");
  await settle();
  crmState.lsqLeads = [{ LeadPropertyList: [{ Attribute: "Phone", Value: "+91-9876500041" }, { Attribute: "FirstName", Value: "Kiran" }, { Attribute: "ProspectID", Value: "p1" }] }];
  const r = await h.call("POST", "/api/whatsapp/integrations/leadsquared/sync", { token: aliceToken, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.imported, 1);
  assert.equal((await Contact().findOne({ userId: alice._id, phone: "919876500041" }).lean()).source, "LeadSquared");
});
