// Project API keys: create, regenerate, revoke, and the public WhatsApp API they unlock.
// Every customer can use the API; without an API package, templates are paid from the wallet.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let alice;
let aliceToken;
let bobToken;
let broke;
let brokeToken;
const sent = [];
let failNextSend = false;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness({ env: { WHATSAPP_TOKEN_ENCRYPTION_KEY: "ef".repeat(32) } });
  const cloud = require("../src/services/whatsappCloudApiService");
  const reply = (kind) => async (to, nameOrText) => {
    if (failNextSend) { failNextSend = false; throw Object.assign(new Error("Meta said no"), { status: 400 }); }
    sent.push({ kind, to, nameOrText });
    return { messages: [{ id: `wamid.api.${sent.length}` }] };
  };
  cloud.sendTemplateMessage = reply("template");
  cloud.sendTextMessage = reply("text");
  const fixtures = require("./helpers/securityFixtures");
  await require("mongoose").models.whatsappApiKey.syncIndexes();
  alice = await fixtures.makeUser({ name: "Alice", whatsappWallet: 100 });
  aliceToken = fixtures.tokenFor(alice);
  bobToken = fixtures.tokenFor(await fixtures.makeUser({ name: "Bob" }));
  broke = await fixtures.makeUser({ name: "Broke", whatsappWallet: 0 });
  brokeToken = fixtures.tokenFor(broke);
  const Account = require("../src/models/whatsappAccountModel");
  const Template = require("../src/models/whatsappTemplateModel");
  for (const [user, n] of [[alice, 1], [broke, 2]]) {
    await Account.create({ userId: user._id, phoneNumberId: `pn-api-${n}`, wabaId: `waba-api-${n}`, phoneNumber: `+91 90000 1100${n}`, accessToken: "t", status: "CONNECTED" });
    await Template.create({ name: n === 1 ? "order_update" : "order_update_b", category: "UTILITY", language: "en", status: "APPROVED", createdBy: user._id, bodyText: "Your order is on its way." });
  }
});

after(async () => {
  if (h) await h.close();
});

const wallet = async (user) => Number((await require("../src/models/userModel").findById(user._id).lean()).whatsappWallet);
const v1 = (method, route, secret, body, headers = {}) =>
  h.call(method, `/api/v1${route}`, { body, headers: { authorization: `Bearer ${secret}`, ...headers } });
const sendTemplate = (secret, name = "order_update") => v1("POST", "/messages", secret, { to: "9876500011", type: "template", template: { name, language: "en" } });

async function createKey(token, name) {
  const r = await h.call("POST", "/api/whatsapp/developer/keys", { token, body: { name } });
  assert.equal(r.status, 201, r.text);
  return r.body.data;
}

test("a key is shown once, listed by its prefix, and only its owner can manage it", { skip }, async () => {
  const key = await createKey(aliceToken, "Website");
  assert.match(key.secret, /^mk_live_[0-9a-f]{48}$/);
  assert.equal(key.access, "send");
  assert.equal(key.service, "whatsapp");

  const list = await h.call("GET", "/api/whatsapp/developer/keys", { token: aliceToken });
  const row = list.body.data.find((k) => k.id === key.id);
  assert.equal(row.secret, undefined);
  assert.equal(row.hint, `${key.secret.slice(0, 16)}…${key.secret.slice(-4)}`);
  assert.equal(row.lastUsedAt, null);

  const blank = await h.call("POST", "/api/whatsapp/developer/keys", { token: aliceToken, body: { name: "  " } });
  assert.equal(blank.status, 400);
  assert.equal((await h.call("POST", `/api/whatsapp/developer/keys/${key.id}/regenerate`, { token: bobToken, body: {} })).status, 403);
  assert.equal((await h.call("POST", `/api/whatsapp/developer/keys/${key.id}/revoke`, { token: bobToken, body: {} })).status, 403);
  assert.equal((await h.call("GET", "/api/whatsapp/developer/keys", { token: bobToken })).body.data.length, 0);
});

test("without an API package the key works and templates are paid from the wallet", { skip }, async () => {
  const key = await createKey(aliceToken, "ERP");
  const account = await v1("GET", "/account", key.secret);
  assert.equal(account.status, 200, account.text);
  assert.equal(account.body.data.billing, "wallet");

  const before = await wallet(alice);
  const r = await sendTemplate(key.secret);
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(r.body.data.charge, { source: "wallet", rupees: 0.2 });
  assert.equal(Number((before - (await wallet(alice))).toFixed(2)), 0.2);

  const Message = require("../src/models/whatsappMessageModel");
  const msg = await Message.findById(r.body.data.id).lean();
  assert.equal(msg.billingState, "reserved");
  assert.equal(msg.billSource, "wallet");
  assert.equal(msg.billPaise, 20);
  const call = await require("../src/models/whatsappApiCallModel").findOne({ messageId: msg._id }).lean();
  assert.equal(call.billSource, "wallet");
  assert.equal(call.billPaise, 20);

  const keys = await h.call("GET", "/api/whatsapp/developer/keys", { token: aliceToken });
  const used = keys.body.data.find((k) => k.id === key.id);
  assert.ok(used.lastUsedAt);
  assert.equal(used.callCount, 1);

  // A text reply goes inside the customer's 24-hour window, which is free.
  const textBefore = await wallet(alice);
  const text = await v1("POST", "/messages", key.secret, { to: "9876500011", type: "text", text: "Hello" });
  assert.equal(text.status, 202, text.text);
  assert.equal(text.body.data.charge.rupees, 0);
  assert.equal(await wallet(alice), textBefore);

  // If WhatsApp refuses the message, the money goes back.
  const refundBefore = await wallet(alice);
  failNextSend = true;
  const refused = await sendTemplate(key.secret);
  assert.equal(refused.status, 400);
  assert.equal(await wallet(alice), refundBefore);
});

test("an empty wallet blocks a template before anything is sent", { skip }, async () => {
  const key = await createKey(brokeToken, "Shop");
  const count = sent.length;
  const r = await sendTemplate(key.secret, "order_update_b");
  assert.equal(r.status, 402);
  assert.match(r.body.message, /wallet/);
  assert.equal(sent.length, count);
  const Call = require("../src/models/whatsappApiCallModel");
  assert.equal(await Call.countDocuments({ keyId: key.id }), 0);
});

test("an active API package pays instead of the wallet", { skip }, async () => {
  const Contract = require("../src/models/developerContractModel");
  await Contract.create({ userId: alice._id, whatsapp: true, chatbot: false, whatsappLimit: 5, chatbotLimit: 0, packageFeeRupees: 0, expiresAt: new Date(Date.now() + 86400000), updatedBy: alice._id });
  try {
    const key = await createKey(aliceToken, "Package");
    const before = await wallet(alice);
    const r = await sendTemplate(key.secret);
    assert.equal(r.status, 202, r.text);
    assert.equal(r.body.data.charge.source, "api_package");
    assert.equal(await wallet(alice), before);
    assert.equal((await Contract.findOne({ userId: alice._id }).lean()).whatsappUsed, 1);
    assert.equal((await v1("GET", "/account", key.secret)).body.data.billing, "api_package");
  } finally {
    await Contract.deleteOne({ userId: alice._id });
  }
});

test("regenerate swaps the secret at once; a revoked key stays dead", { skip }, async () => {
  const key = await createKey(aliceToken, "Mobile app");
  assert.equal((await v1("GET", "/templates", key.secret)).status, 200);

  const regen = await h.call("POST", `/api/whatsapp/developer/keys/${key.id}/regenerate`, { token: aliceToken, body: {} });
  assert.equal(regen.status, 200, regen.text);
  const fresh = regen.body.data;
  assert.equal(fresh.id, key.id);
  assert.equal(fresh.name, "Mobile app");
  assert.equal(fresh.lastUsedAt, null);
  assert.notEqual(fresh.secret, key.secret);
  assert.equal((await v1("GET", "/templates", key.secret)).status, 401);
  assert.equal((await v1("GET", "/templates", fresh.secret)).status, 200);

  const revoked = await h.call("POST", `/api/whatsapp/developer/keys/${key.id}/revoke`, { token: aliceToken, body: {} });
  assert.equal(revoked.status, 200);
  assert.ok(revoked.body.data.revokedAt);
  assert.equal((await v1("GET", "/templates", fresh.secret)).status, 401);
  assert.equal((await h.call("POST", `/api/whatsapp/developer/keys/${key.id}/regenerate`, { token: aliceToken, body: {} })).status, 409);
});
