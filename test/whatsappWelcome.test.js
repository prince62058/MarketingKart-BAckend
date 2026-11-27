// Welcome WhatsApp on sign-in: the company number sends each product's image template once per
// number. Real app models on a throwaway mongod; the Meta send is a fake.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let welcome;
let cloud;
let sends = [];
let failNext = false;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  cloud = require("../src/services/whatsappCloudApiService");
  cloud.sendTemplateMessage = async (to, name, language, components, credentials) => {
    if (failNext) { failNext = false; throw new Error("Template does not exist"); }
    sends.push({ to, name, language, components, credentials });
    return { messages: [{ id: `wamid.${sends.length}` }] };
  };
  welcome = require("../src/services/whatsappWelcomeService");
  await require("../src/models/whatsappWelcomeModel").syncIndexes();
  const owner = await require("./helpers/securityFixtures").makeUser({ name: "MarketingKart" });
  await require("../src/models/whatsappAccountModel").create({ userId: owner._id, phoneNumberId: "pn-company", wabaId: "waba-company", phoneNumber: "+91 91111 55016", accessToken: "company-token", status: "CONNECTED" });
});

after(async () => {
  delete process.env.WELCOME_WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WELCOME_CALL_NUMBER;
  if (h) await h.close();
});

beforeEach(() => {
  sends = [];
  failNext = false;
  process.env.WELCOME_WHATSAPP_PHONE_NUMBER_ID = "pn-company";
});

test("apps' product names map to the three welcomes", () => {
  const { productFrom } = require("../src/services/whatsappWelcomeService");
  assert.equal(productFrom("whatsapp"), "whatsapp");
  assert.equal(productFrom("WhatsApp Marketing"), "whatsapp");
  assert.equal(productFrom("ai-video"), "ai_video");
  assert.equal(productFrom(undefined, "meta_ads"), "meta_ads");
  assert.equal(productFrom("admin"), null);
});

test("the template has the image header, the name variable and a call or quick-reply button", () => {
  const w = require("../src/services/whatsappWelcomeService");
  delete process.env.WELCOME_CALL_NUMBER;
  let c = w.templateComponents("meta_ads");
  assert.equal(c[0].format, "IMAGE");
  assert.equal(c[0].example.header_handle[0], "https://api.marketingkart.in/images/welcome/meta.jpg");
  assert.match(c[1].text, /^Hi \{\{1\}\}, welcome/);
  assert.deepEqual(c[3].buttons.map((b) => b.type), ["URL", "QUICK_REPLY"]);
  process.env.WELCOME_CALL_NUMBER = "91111 55016";
  c = w.templateComponents("meta_ads");
  assert.deepEqual(c[3].buttons[1], { type: "PHONE_NUMBER", text: "Call Account Manager", phone_number: "+919111155016" });
  for (const p of Object.keys(w.PRODUCTS)) {
    const body = w.templateComponents(p)[1].text;
    assert.ok(body.length <= 1024, `${p} body too long`);
    assert.ok(w.templateComponents(p)[2].text.length <= 60);
  }
  delete process.env.WELCOME_CALL_NUMBER;
});

test("nothing is sent until the company sender is set", { skip }, async () => {
  delete process.env.WELCOME_WHATSAPP_PHONE_NUMBER_ID;
  const user = await require("./helpers/securityFixtures").makeUser({ name: "Asha Rao" });
  assert.deepEqual(await welcome.sendWelcome(user, "meta_ads"), { skipped: "no sender configured" });
  assert.equal(sends.length, 0);
});

test("a sign-in gets its product's welcome once, from the company number", { skip }, async () => {
  const user = await require("./helpers/securityFixtures").makeUser({ name: "Asha Rao", mobile: "9876500011" });
  const r = await welcome.sendWelcome(user, "whatsapp");
  assert.equal(r.sent, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, "919876500011");
  assert.equal(sends[0].name, "mk_welcome_whatsapp");
  assert.equal(sends[0].credentials.phoneNumberId, "pn-company");
  assert.equal(sends[0].credentials.accessToken, "company-token");
  assert.deepEqual(sends[0].components, [
    { type: "header", parameters: [{ type: "image", image: { link: "https://api.marketingkart.in/images/welcome/whatsapp.jpg" } }] },
    { type: "body", parameters: [{ type: "text", text: "Asha" }] },
  ]);
  assert.deepEqual(await welcome.sendWelcome(user, "whatsapp"), { skipped: "already welcomed" });
  // A different product is its own welcome.
  assert.equal((await welcome.sendWelcome(user, "ai_video")).sent, true);
  assert.equal(sends.length, 2);
  const rows = await require("../src/models/whatsappWelcomeModel").find({ phone: "919876500011" }).lean();
  assert.deepEqual(rows.map((r) => r.status).sort(), ["SENT", "SENT"]);
});

test("two sign-ins at the same moment send one welcome", { skip }, async () => {
  const user = await require("./helpers/securityFixtures").makeUser({ name: "Ravi", mobile: "9876500022" });
  const results = await Promise.all([welcome.sendWelcome(user, "meta_ads"), welcome.sendWelcome(user, "meta_ads"), welcome.sendWelcome(user, "meta_ads")]);
  assert.equal(results.filter((r) => r.sent).length, 1);
  assert.equal(sends.length, 1);
});

test("admins and staff get no welcome; placeholder names become 'there'", { skip }, async () => {
  const fx = require("./helpers/securityFixtures");
  assert.deepEqual(await welcome.sendWelcome(await fx.makeAdmin(), "meta_ads"), { skipped: "not a customer" });
  const nameless = await fx.makeUser({ name: "User 3", mobile: "9876500033" });
  await welcome.sendWelcome(nameless, "meta_ads");
  assert.equal(sends[0].components[1].parameters[0].text, "there");
});

test("a failed welcome is kept and retried only after a while", { skip }, async () => {
  const Welcome = require("../src/models/whatsappWelcomeModel");
  const user = await require("./helpers/securityFixtures").makeUser({ name: "Meena", mobile: "9876500044" });
  failNext = true;
  const first = await welcome.sendWelcome(user, "ai_video");
  assert.match(first.failed, /does not exist/);
  assert.deepEqual(await welcome.sendWelcome(user, "ai_video"), { skipped: "already welcomed" });
  await Welcome.collection.updateOne({ phone: "919876500044", product: "ai_video" }, { $set: { updatedAt: new Date(Date.now() - 7 * 3600 * 1000) } });
  const retry = await welcome.sendWelcome(user, "ai_video");
  assert.equal(retry.sent, true);
  const row = await Welcome.findOne({ phone: "919876500044", product: "ai_video" }).lean();
  assert.equal(row.status, "SENT");
  assert.equal(row.attempts, 2);
});
