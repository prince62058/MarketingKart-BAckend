const { test } = require("node:test");
const assert = require("node:assert/strict");
const developer = require("../src/services/whatsappDeveloperService");

test("an Indian mobile without a country code is sent as 91", () => {
  assert.equal(developer.normalizeTo("98765 43210"), "919876543210");
  assert.equal(developer.normalizeTo("+1 (415) 555-2671"), "14155552671");
  assert.equal(developer.normalizeTo("12345"), null);
});

test("a project key hashes the same way every time and is not the raw secret", () => {
  const minted = developer.generateKey();
  assert.match(minted.raw, /^mk_live_[a-f0-9]{48}$/);
  assert.equal(developer.hashKey(minted.raw), minted.hash);
  assert.notEqual(minted.hash, minted.raw);
  assert.equal(minted.prefix, minted.raw.slice(0, 16));
  assert.equal(minted.last4, minted.raw.slice(-4));
});

test("status webhooks are signed over the exact body", () => {
  const body = JSON.stringify({ event: "message.status", status: "DELIVERED" });
  const first = developer.signBody("secret", body);
  const second = developer.signBody("secret", body);
  assert.equal(first, second);
  assert.notEqual(first, developer.signBody("other", body));
});

test("webhook addresses have to be public https", () => {
  assert.equal(developer.assertPublicHttps("https://example.com/hooks/whatsapp"), "https://example.com/hooks/whatsapp");
  assert.throws(() => developer.assertPublicHttps("http://example.com/hook"), /https/);
  assert.throws(() => developer.assertPublicHttps("https://127.0.0.1/hook"), /public/);
  assert.throws(() => developer.assertPublicHttps("https://192.168.1.9/hook"), /public/);
  assert.throws(() => developer.assertPublicHttps("https://localhost/hook"), /public/);
});

test("missing days stay in the usage graph as zeros", () => {
  const series = developer.fillDays([{ _id: developer.fillDays([], 1)[0].date, calls: 4, delivered: 3, failed: 1, spentPaise: 80 }], 3);
  assert.equal(series.length, 3);
  assert.equal(series.reduce((sum, day) => sum + day.calls, 0), 4);
  assert.ok(series.some((day) => day.calls === 0));
});

test("an unknown key permission is rejected before persistence", async () => {
  await assert.rejects(developer.createKey({}, "CRM", undefined, "admin"), { status: 400 });
});

test("message detail queries are scoped to the authenticated account", async (t) => {
  const Call = require("../src/models/whatsappApiCallModel");
  const id = "612345678901234567890123";
  t.mock.method(Call, "findOne", (query) => {
    assert.deepEqual(query, { userId: "tenant-a", $or: [{ _id: id }, { messageId: id }] });
    return { lean: async () => null };
  });
  await assert.rejects(developer.messageDetail({ _id: "tenant-a" }, id), { status: 404 });
});

test("read-only keys cannot enter the message sending controller", () => {
  const router = require("../src/routes/whatsappPublicApiRoute");
  const route = router.stack.find(({ route }) => route?.path === "/messages" && route.methods.post).route;
  const guard = route.stack[0].handle;
  const response = { status(code) { assert.equal(code, 403); return this; }, json(body) { assert.equal(body.success, false); } };
  guard({ apiKey: { access: "read" } }, response, () => assert.fail("send was allowed"));
  let forwarded = false;
  guard({ apiKey: {} }, response, () => { forwarded = true; });
  assert.equal(forwarded, true);
});

test("staff and customer sessions cannot assign API packages", async () => {
  const contract = require("../src/services/developerContract");
  for (const userType of ["STAFF", "USER"]) {
    await assert.rejects(contract.save({userType}, "id", {}), {status:403});
  }
});

test("chatbot requests use an atomic account-specific allowance", async t => {
  const Model = require("../src/models/developerContractModel");
  const contract = require("../src/services/developerContract");
  t.mock.method(Model, "updateOne", async (query, update) => {
    assert.equal(query.userId,"customer");
    assert.equal(query.chatbot,true);
    assert.deepEqual(query.$expr,{$lt:["$chatbotUsed","$chatbotLimit"]});
    assert.deepEqual(update,{$inc:{chatbotUsed:1}});
    return {modifiedCount:0};
  });
  t.mock.method(Model,"exists",async()=>true);
  await assert.rejects(contract.authorize("customer","chatbot",true),{status:429});
});

test("only matching fully paid invoices can settle", () => {
  const {fullyPaid} = require("../src/services/developerInvoices");
  const bill = {_id:"invoice",providerId:"plink",amountPaise:12500};
  const event = {id:"plink",reference_id:"invoice",currency:"INR",status:"paid",amount:12500,amount_paid:12500};
  assert.equal(fullyPaid(bill,event),true);
  for (const diff of [{id:"other"},{reference_id:"other"},{currency:"USD"},{status:"created"},{amount_paid:100}]) {
    assert.equal(fullyPaid(bill,{...event,...diff}),false);
  }
});

test("developer administration excludes staff identities", () => {
  assert.equal(developer.isAdmin({userType:"STAFF"}),false);
  assert.equal(developer.isAdmin({userType:"ADMIN"}),true);
});

test("customer sessions cannot list other tenants or issue invoices", async () => {
  const ctrl=require("../src/controllers/whatsappDeveloperController");
  const req={user:{_id:"a",userType:"USER"},params:{userId:"b"},method:"POST",body:{}};
  for (const action of [ctrl.customers,ctrl.invoices]) {
    let status;
    const res={status(code){status=code;return this;},json(){}};
    await action(req,res);
    assert.equal(status,403);
  }
});

test("customer send form looks up the key by authenticated tenant and active status", async t=>{
  const ctrl=require("../src/controllers/whatsappDeveloperController");
  const Key=require("../src/models/whatsappApiKeyModel");
  const keyId="612345678901234567890123";
  t.mock.method(Key,"findOne",async query=>{
    assert.deepEqual(query,{_id:keyId,userId:"owner",revokedAt:null});return null;
  });
  let status;
  await ctrl.panelSend({user:{_id:"owner"},body:{keyId}}, {status(n){status=n;return this;},json(){}});
  assert.equal(status,403);
});

test("bot profile lookup and update require an unexpired tenant chatbot grant",async t=>{
  const model=require("../src/models/developerContractModel");
  const contract=require("../src/services/developerContract");
  const check=query=>{
    assert.equal(query.userId,"customer");assert.equal(query.chatbot,true);
    assert.ok(query.expiresAt.$gt instanceof Date);
    return {select:()=>({lean:async()=>null})};
  };
  t.mock.method(model,"findOne",check);
  t.mock.method(model,"findOneAndUpdate",check);
  await assert.rejects(contract.profile("customer"),{status:403});
  await assert.rejects(contract.profile("customer",{businessName:"Shop",systemPrompt:"",faqs:[]}),{status:403});
});
