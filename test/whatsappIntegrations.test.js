// Integrations against the real app and a throwaway mongod: store webhooks (signature, events,
// phone lookup, billed sends), Google Sheets rows → contacts, and the connect/mapping API.
// WhatsApp sends are replaced by a fake that records what would have gone out.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let alice;
let aliceToken;
let bobToken;
let template;
const sent = [];

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness({ env: { WHATSAPP_TOKEN_ENCRYPTION_KEY: "cd".repeat(32) } });
  const cloud = require("../src/services/whatsappCloudApiService");
  cloud.sendTemplateMessage = async (to, name, language, components) => {
    sent.push({ to, name, language, components });
    return { messages: [{ id: `wamid.${sent.length}` }] };
  };
  const fixtures = require("./helpers/securityFixtures");
  for (const name of ["whatsappIntegration", "whatsappSheet", "whatsappOrderIndex", "whatsappContact"]) {
    await require("mongoose").models[name]?.syncIndexes();
  }
  alice = await fixtures.makeUser({ name: "Alice", whatsappWallet: 100 });
  aliceToken = fixtures.tokenFor(alice);
  bobToken = fixtures.tokenFor(await fixtures.makeUser({ name: "Bob" }));
  await require("../src/models/whatsappAccountModel").create({ userId: alice._id, phoneNumberId: "pn-a", wabaId: "waba-a", phoneNumber: "+91 91111 55016", accessToken: "t", status: "CONNECTED" });
  template = await require("../src/models/whatsappTemplateModel").create({
    name: "order_placed", category: "UTILITY", language: "en", status: "APPROVED", createdBy: alice._id,
    bodyText: "Hi {{1}}, order {{2}} is confirmed.",
    components: [{ type: "BODY", text: "Hi {{1}}, order {{2}} is confirmed.", example: { body_text: [["Asha", "#1001"]] } }],
  });
});

after(async () => {
  if (h) await h.close();
});

const signed = (secret, body) => crypto.createHmac("sha256", secret).update(JSON.stringify(body)).digest("base64");
const tokenOf = (url) => url.split("/").pop();
const settle = () => new Promise((r) => setTimeout(r, 400));

test("event names come from each store's topic or status", () => {
  const svc = require("../src/services/whatsappIntegrationService");
  assert.deepEqual(svc.shopifyEvents("orders/create", {}), ["order_created"]);
  assert.deepEqual(svc.shopifyEvents("fulfillment_events/create", { status: "out_for_delivery" }), ["order_out_for_delivery"]);
  assert.deepEqual(svc.wooEvents("order.updated", { status: "on-hold" }), ["order_updated", "order_on_hold"]);
  assert.deepEqual(svc.shiprocketEvents({ current_status: "OUT FOR DELIVERY" }), ["shipment_out_for_delivery"]);
  assert.deepEqual(svc.shiprocketEvents({ current_status: "UNDELIVERED" }), ["shipment_ndr"]);
  assert.deepEqual(svc.shiprocketEvents({ current_status: "Delivered" }), ["shipment_delivered"]);
});

test("integration settings need a sign-in", { skip }, async () => {
  for (const [method, path] of [["GET", "/api/whatsapp/integrations"], ["POST", "/api/whatsapp/integrations/shopify/connect"], ["GET", "/api/whatsapp/integrations/google-sheets/sheets"]]) {
    const r = await h.call(method, path, { body: method === "GET" ? undefined : {} });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
  const sheets = await h.call("POST", "/api/v1/google-sheets/rows", { body: {} });
  assert.equal(sheets.status, 401);
});

test("Shopify: connect, map an event, and a signed order sends the template (billed)", { skip }, async () => {
  const bad = await h.call("POST", "/api/whatsapp/integrations/shopify/connect", { token: aliceToken, body: { secret: "short" } });
  assert.equal(bad.status, 400);
  const c = await h.call("POST", "/api/whatsapp/integrations/shopify/connect", { token: aliceToken, body: { secret: "shpss_secret_1234", label: "demo.myshopify.com" } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.match(c.body.data.webhookUrl, /\/api\/webhooks\/ecommerce\/shopify\/[a-f0-9]{48}$/);
  assert.equal(c.body.data.secret, undefined);
  const token = tokenOf(c.body.data.webhookUrl);

  const noTemplate = await h.call("POST", "/api/whatsapp/integrations/shopify/mappings", { token: aliceToken, body: { event: "order_created", templateId: "64b000000000000000000001" } });
  assert.equal(noTemplate.status, 400);
  const m = await h.call("POST", "/api/whatsapp/integrations/shopify/mappings", { token: aliceToken, body: { event: "order_created", templateId: String(template._id), phoneField: "customer.phone", variables: { 1: "customer.first_name", 2: "name" } } });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const bobMap = await h.call("POST", "/api/whatsapp/integrations/shopify/mappings", { token: bobToken, body: { event: "order_created", templateId: String(template._id) } });
  assert.equal(bobMap.status, 409);

  const order = { id: 5001, name: "#1001", order_number: 1001, customer: { first_name: "Asha", phone: "+91 98765 00011" }, line_items: [{ title: "Tea" }] };
  const unsigned = await h.call("POST", `/api/webhooks/ecommerce/shopify/${token}`, { body: order, headers: { "x-shopify-topic": "orders/create" } });
  assert.equal(unsigned.status, 401);
  const wrong = await h.call("POST", `/api/webhooks/ecommerce/shopify/${"0".repeat(48)}`, { body: order, headers: { "x-shopify-topic": "orders/create", "x-shopify-hmac-sha256": signed("shpss_secret_1234", order) } });
  assert.equal(wrong.status, 404);
  const before = sent.length;
  const ok = await h.call("POST", `/api/webhooks/ecommerce/shopify/${token}`, { body: order, headers: { "x-shopify-topic": "orders/create", "x-shopify-hmac-sha256": signed("shpss_secret_1234", order) } });
  assert.equal(ok.status, 200);
  await settle();
  assert.equal(sent.length, before + 1);
  const out = sent[sent.length - 1];
  assert.equal(out.to, "919876500011");
  assert.equal(out.name, "order_placed");
  assert.deepEqual(out.components, [{ type: "body", parameters: [{ type: "text", text: "Asha" }, { type: "text", text: "#1001" }] }]);
  const msg = await require("../src/models/whatsappMessageModel").findOne({ metaMessageId: `wamid.${sent.length}` }).lean();
  assert.equal(msg.source, "INTEGRATION");
  assert.equal(msg.billingState, "reserved");
  assert.equal(msg.textBody, "Hi Asha, order #1001 is confirmed.");
  const list = await h.call("GET", "/api/whatsapp/integrations", { token: aliceToken });
  assert.equal(list.body.data.shopify.integration.mappings[0].sent, 1);
});

test("Shiprocket finds the customer through the store order and checks its token", { skip }, async () => {
  const c = await h.call("POST", "/api/whatsapp/integrations/shiprocket/connect", { token: aliceToken, body: { secret: "sr_token_123456" } });
  const token = tokenOf(c.body.data.webhookUrl);
  await h.call("POST", "/api/whatsapp/integrations/shiprocket/mappings", { token: aliceToken, body: { event: "shipment_out_for_delivery", templateId: String(template._id), phoneField: "order", variables: { 1: "customer_name", 2: "awb" } } });
  const update = { order_id: "1001", awb: "AWB778", current_status: "OUT FOR DELIVERY" };
  const bad = await h.call("POST", `/api/webhooks/ecommerce/shiprocket/${token}`, { body: update, headers: { "x-api-key": "nope" } });
  assert.equal(bad.status, 401);
  const before = sent.length;
  const ok = await h.call("POST", `/api/webhooks/ecommerce/shiprocket/${token}`, { body: update, headers: { "x-api-key": "sr_token_123456" } });
  assert.equal(ok.status, 200);
  await settle();
  assert.equal(sent.length, before + 1);
  assert.equal(sent[sent.length - 1].to, "919876500011");
  assert.deepEqual(sent[sent.length - 1].components[0].parameters.map((p) => p.text), ["Asha", "AWB778"]);
});

test("WooCommerce: the unsigned ping is accepted, a status change sends its mapping", { skip }, async () => {
  const c = await h.call("POST", "/api/whatsapp/integrations/woocommerce/connect", { token: aliceToken, body: { secret: "wc_secret_abcdef" } });
  const token = tokenOf(c.body.data.webhookUrl);
  await h.call("POST", "/api/whatsapp/integrations/woocommerce/mappings", { token: aliceToken, body: { event: "order_completed", templateId: String(template._id), phoneField: "billing.phone", variables: { 1: "billing.first_name", 2: "number" } } });
  const ping = await h.call("POST", `/api/webhooks/ecommerce/woocommerce/${token}`, { body: { webhook_id: 7 } });
  assert.equal(ping.status, 200);
  const order = { id: 77, number: "77", status: "completed", billing: { first_name: "Ravi", phone: "9800000002" }, line_items: [] };
  const before = sent.length;
  const ok = await h.call("POST", `/api/webhooks/ecommerce/woocommerce/${token}`, { body: order, headers: { "x-wc-webhook-topic": "order.updated", "x-wc-webhook-signature": signed("wc_secret_abcdef", order) } });
  assert.equal(ok.status, 200);
  await settle();
  assert.equal(sent.length, before + 1);
  assert.equal(sent[sent.length - 1].to, "919800000002");
});

test("Google Sheets: header row, mapping, rows become contacts in the group", { skip }, async () => {
  const svc = require("../src/services/whatsappIntegrationService");
  const s = await h.call("POST", "/api/whatsapp/integrations/google-sheets/sheets", { token: aliceToken, body: { name: "Leads" } });
  assert.equal(s.status, 201);
  const sheet = s.body.data;
  assert.equal(sheet.needsMapping, true);
  await assert.rejects(svc.receiveHeaders(alice._id, { sync_token: "wrong", headers: ["a"] }), /not one of your connected sheets/);
  await svc.receiveHeaders(alice._id, { sync_token: sheet.syncToken, headers: ["Full Name", "Mobile", "City"] });
  const early = await svc.receiveRows(alice._id, { sync_token: sheet.syncToken, rows: [{ Mobile: "9800000003" }] });
  assert.equal(early.needsMapping, true);
  const group = await h.call("POST", "/api/whatsapp/contact-groups", { token: aliceToken, body: { name: "From sheet" } });
  const badMap = await h.call("PUT", `/api/whatsapp/integrations/google-sheets/sheets/${sheet._id}`, { token: aliceToken, body: { mapping: { phone: "Nope" } } });
  assert.equal(badMap.status, 400);
  const map = await h.call("PUT", `/api/whatsapp/integrations/google-sheets/sheets/${sheet._id}`, { token: aliceToken, body: { mapping: { phone: "Mobile", name: "Full Name" }, groupId: group.body.data._id } });
  assert.equal(map.status, 200, JSON.stringify(map.body));
  const r = await svc.receiveRows(alice._id, { sync_token: sheet.syncToken, rows: [{ "Full Name": "Meena", Mobile: "9800000003", City: "Pune" }, { "Full Name": "No phone", Mobile: "" }] });
  assert.deepEqual(r, { imported: 1, skipped: 1 });
  const contact = await require("../src/models/whatsappContactModel").findOne({ userId: alice._id, phone: "919800000003" }).lean();
  assert.equal(contact.name, "Meena");
  assert.deepEqual(contact.groups.map(String), [group.body.data._id]);
  const badUrl = await h.call("PUT", `/api/whatsapp/integrations/google-sheets/sheets/${sheet._id}`, { token: aliceToken, body: { webAppUrl: "https://evil.example/exec" } });
  assert.equal(badUrl.status, 400);
  const bob = await h.call("DELETE", `/api/whatsapp/integrations/google-sheets/sheets/${sheet._id}`, { token: bobToken });
  assert.equal(bob.status, 404);
});

test("LeadSquared host is checked before any call; HubSpot/Zoho say when keys are missing", { skip }, async () => {
  const bad = await h.call("POST", "/api/whatsapp/integrations/leadsquared/connect", { token: aliceToken, body: { host: "evil.example.com", accessKey: "a", secretKey: "b" } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /leadsquared\.com/);
  const hub = await h.call("POST", "/api/whatsapp/integrations/hubspot/oauth/start", { token: aliceToken, body: {} });
  assert.equal(hub.status, 503);
  const list = await h.call("GET", "/api/whatsapp/integrations", { token: aliceToken });
  assert.equal(list.body.data.hubspot.available, false);
  assert.equal(list.body.data.google_sheets.connected, true);
});

test("disconnecting removes the app and its mappings", { skip }, async () => {
  const r = await h.call("DELETE", "/api/whatsapp/integrations/woocommerce", { token: aliceToken });
  assert.equal(r.status, 200);
  const again = await h.call("DELETE", "/api/whatsapp/integrations/woocommerce", { token: aliceToken });
  assert.equal(again.status, 404);
});
