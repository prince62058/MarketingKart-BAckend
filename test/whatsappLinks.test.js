// Link & QR links and chat labels: the API, and what a matching customer message does
// (join the link's group, label the chat; label and group keywords too). Real app, throwaway mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let alice;
let aliceToken;
let bobToken;
let conversation;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness({ env: { WHATSAPP_TOKEN_ENCRYPTION_KEY: "cd".repeat(32) } });
  const fixtures = require("./helpers/securityFixtures");
  const mongoose = require("mongoose");
  for (const name of ["whatsappLabel", "whatsappLink", "whatsappContact", "whatsappContactGroup"]) {
    await mongoose.models[name]?.syncIndexes();
  }
  alice = await fixtures.makeUser({ name: "Alice" });
  aliceToken = fixtures.tokenFor(alice);
  bobToken = fixtures.tokenFor(await fixtures.makeUser({ name: "Bob" }));
  const business = await fixtures.makeBusiness(alice);
  await require("../src/models/whatsappAccountModel").create({
    userId: alice._id, phoneNumberId: "pn-alice", wabaId: "waba-alice", phoneNumber: "+91 91111 55016", accessToken: "t", status: "CONNECTED",
  });
  conversation = await require("../src/models/whatsappConversationModel").create({
    businessId: business._id, wabaId: "waba-alice", phoneNumberId: "pn-alice", customerPhone: "919800000001", customerName: "Ravi",
  });
});

after(async () => {
  if (h) await h.close();
});

test("keywords match whole words in any script", () => {
  const { hasKeyword, matchKey } = require("../src/services/whatsappLinkService");
  assert.equal(hasKeyword("What is the PRICE?", "price"), true);
  assert.equal(hasKeyword("enterprise plan", "price"), false);
  assert.equal(hasKeyword("मुझे कीमत बताओ", "कीमत"), true);
  assert.equal(matchKey("  Hi   I saw your POSTER "), "hi i saw your poster");
});

test("links and labels need a sign-in", { skip }, async () => {
  for (const [method, path] of [["GET", "/api/whatsapp/labels"], ["POST", "/api/whatsapp/labels"], ["GET", "/api/whatsapp/links"], ["POST", "/api/whatsapp/links"], ["PUT", "/api/whatsapp/conversations/64b000000000000000000001/labels"]]) {
    const r = await h.call(method, path, { body: method === "GET" ? undefined : {} });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test("labels: create, rename, no duplicates, only your own", { skip }, async () => {
  const made = await h.call("POST", "/api/whatsapp/labels", { token: aliceToken, body: { name: "Hot lead", color: "#ff0000", keywords: [" Price ", "price", "DEMO"] } });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.data.keywords, ["price", "demo"]);
  const dup = await h.call("POST", "/api/whatsapp/labels", { token: aliceToken, body: { name: "Hot lead" } });
  assert.equal(dup.status, 409);
  const renamed = await h.call("PUT", `/api/whatsapp/labels/${made.body.data._id}`, { token: aliceToken, body: { name: "Hot", color: "bad", keywords: ["price"] } });
  assert.equal(renamed.body.data.name, "Hot");
  assert.equal(renamed.body.data.color, "#00a884");
  const bobEdit = await h.call("PUT", `/api/whatsapp/labels/${made.body.data._id}`, { token: bobToken, body: { name: "Mine" } });
  assert.equal(bobEdit.status, 404);
  const bobList = await h.call("GET", "/api/whatsapp/labels", { token: bobToken });
  assert.equal(bobList.body.data.length, 0);
});

test("a link is built from the connected number and checks its group and labels", { skip }, async () => {
  const group = await h.call("POST", "/api/whatsapp/contact-groups", { token: aliceToken, body: { name: "Poster leads" } });
  const groupId = group.body.data._id;
  const label = await h.call("POST", "/api/whatsapp/labels", { token: aliceToken, body: { name: "Poster" } });
  const r = await h.call("POST", "/api/whatsapp/links", { token: aliceToken, body: { text: "Hi I saw your poster", groupId, labelIds: [label.body.data._id, "64b000000000000000000099"] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.link, "https://wa.me/919111155016?text=Hi%20I%20saw%20your%20poster");
  assert.deepEqual(r.body.data.labelIds, [label.body.data._id]);
  const noText = await h.call("POST", "/api/whatsapp/links", { token: aliceToken, body: { text: "", groupId } });
  assert.equal(noText.status, 400);
  const bobGroup = await h.call("POST", "/api/whatsapp/links", { token: bobToken, body: { text: "x", groupId } });
  assert.equal(bobGroup.status, 400);
  const bobNoNumber = await h.call("POST", "/api/whatsapp/links", { token: bobToken, body: { text: "x" } });
  assert.equal(bobNoNumber.status, 409);
});

test("a customer who sends the link's message joins its group and the chat is labelled", { skip }, async () => {
  const svc = require("../src/services/whatsappLinkService");
  const Contact = require("../src/models/whatsappContactModel");
  const Conversation = require("../src/models/whatsappConversationModel");
  const links = (await h.call("GET", "/api/whatsapp/links", { token: aliceToken })).body.data;
  const link = links.find((l) => l.text === "Hi I saw your poster");
  const labels = (await h.call("GET", "/api/whatsapp/labels", { token: aliceToken })).body.data;
  const hot = labels.find((l) => l.name === "Hot");

  const none = await svc.applyInbound({ userId: alice._id, conversation, customerPhone: "919800000001", customerName: "Ravi", text: "good morning" });
  assert.deepEqual(none, { link: null, groups: [], labels: [] });

  const done = await svc.applyInbound({ userId: alice._id, conversation, customerPhone: "919800000001", customerName: "Ravi", text: "  hi i saw  your POSTER " });
  assert.equal(done.link, String(link._id));
  const contact = await Contact.findOne({ userId: alice._id, phone: "919800000001" }).lean();
  assert.equal(contact.name, "Ravi");
  assert.equal(contact.source, "Link & QR");
  assert.deepEqual(contact.groups.map(String), [String(link.groupId)]);
  let conv = await Conversation.findById(conversation._id).lean();
  assert.deepEqual(conv.labels.map(String), link.labelIds.map(String));
  assert.equal((await require("../src/models/whatsappLinkModel").findById(link._id).lean()).joins, 1);

  // A label keyword adds that label too, without touching the others.
  await svc.applyInbound({ userId: alice._id, conversation, customerPhone: "919800000001", customerName: "Ravi", text: "What is the price?" });
  conv = await Conversation.findById(conversation._id).lean();
  assert.ok(conv.labels.map(String).includes(String(hot._id)));
  assert.equal(conv.labels.length, 2);
});

test("a group keyword adds the customer to that group", { skip }, async () => {
  const svc = require("../src/services/whatsappLinkService");
  const g = await h.call("POST", "/api/whatsapp/contact-groups", { token: aliceToken, body: { name: "Wholesale", keywords: ["bulk"] } });
  await svc.applyInbound({ userId: alice._id, conversation, customerPhone: "919800000002", customerName: "Unknown", text: "Need a BULK order" });
  const contact = await require("../src/models/whatsappContactModel").findOne({ userId: alice._id, phone: "919800000002" }).lean();
  assert.deepEqual(contact.groups.map(String), [g.body.data._id]);
  assert.equal(contact.source, "Organic");
  assert.equal(contact.name, "");
});

test("only the owner can label a chat, and only with their own labels", { skip }, async () => {
  const labels = (await h.call("GET", "/api/whatsapp/labels", { token: aliceToken })).body.data;
  const set = await h.call("PUT", `/api/whatsapp/conversations/${conversation._id}/labels`, { token: aliceToken, body: { labelIds: [labels[0]._id] } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.data.labels, [labels[0]._id]);
  const bob = await h.call("PUT", `/api/whatsapp/conversations/${conversation._id}/labels`, { token: bobToken, body: { labelIds: [] } });
  assert.equal(bob.status, 404);
  const list = await h.call("GET", "/api/whatsapp/chat/conversations", { token: aliceToken });
  assert.deepEqual(list.body.data.find((c) => c._id === String(conversation._id)).labels, [labels[0]._id]);
});

test("deleting a label takes it off chats and links", { skip }, async () => {
  const labels = (await h.call("GET", "/api/whatsapp/labels", { token: aliceToken })).body.data;
  const poster = labels.find((l) => l.name === "Poster");
  await h.call("PUT", `/api/whatsapp/conversations/${conversation._id}/labels`, { token: aliceToken, body: { labelIds: [poster._id] } });
  const del = await h.call("DELETE", `/api/whatsapp/labels/${poster._id}`, { token: aliceToken });
  assert.equal(del.status, 200);
  const conv = await require("../src/models/whatsappConversationModel").findById(conversation._id).lean();
  assert.deepEqual(conv.labels, []);
  const links = (await h.call("GET", "/api/whatsapp/links", { token: aliceToken })).body.data;
  assert.ok(links.every((l) => !l.labelIds.includes(poster._id)));
});
