// Socket.IO access control: no connection without a valid login, and a room only for someone who is
// allowed to see what is pushed into it. Run against the real socket module and a throwaway mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const { SocketClient } = require("./helpers/socketClient");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;
let httpServer;
let io;
let url;
const clients = [];
let owner;
let teammate;
let stranger;
let admin;
let business;
let conversation;
let campaign;

const connect = async options => {
  const client = new SocketClient(url, options);
  clients.push(client);
  await client.ready;
  return client;
};
const as = (user, extra = {}) => connect({ auth: { token: fixtures.tokenFor(user) }, ...extra });

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness({ app: false });
  const { Server } = require(path.join(__dirname, "..", "node_modules", "socket.io"));
  const { authenticateSocket, registerSocketHandlers } = require("../src/socket/socketAuth");
  httpServer = http.createServer();
  io = new Server(httpServer);
  io.use(authenticateSocket);
  io.on("connection", socket => registerSocketHandlers(io, socket));
  await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${httpServer.address().port}`;

  owner = await fixtures.makeUser({ name: "Owner" });
  stranger = await fixtures.makeUser({ name: "Stranger" });
  admin = await fixtures.makeAdmin();
  business = await fixtures.makeBusiness(owner);
  teammate = await fixtures.makeUser({ name: "Teammate", businessId: [business._id] });
  conversation = await require("../src/models/whatsappConversationModel").create({
    businessId: business._id,
    wabaId: "waba-1",
    phoneNumberId: "phone-1",
    customerPhone: "919999999999",
  });
  campaign = await require("../src/models/whatsappCampaignModel").create({
    templateId: owner._id,
    businessId: business._id,
    createdBy: owner._id,
    name: "Diwali",
  });
});

after(async () => {
  for (const client of clients) client.close();
  if (io) await new Promise(resolve => io.close(resolve));
  if (httpServer?.listening) await new Promise(resolve => httpServer.close(resolve));
  if (h) await h.close();
});

test("a connection without a login token is refused", { skip }, async () => {
  const client = await connect({});
  assert.equal(client.state, "rejected");
  assert.equal(client.error, "unauthorized");
});

test("a garbage, wrongly signed or revoked-account token is refused", { skip }, async () => {
  assert.equal((await connect({ auth: { token: "not-a-jwt" } })).state, "rejected");

  const jwt = require(path.join(__dirname, "..", "node_modules", "jsonwebtoken"));
  const forged = jwt.sign({ User: String(owner._id) }, "some other secret");
  assert.equal((await connect({ auth: { token: forged } })).state, "rejected");

  const banned = await fixtures.makeUser();
  const token = fixtures.tokenFor(banned);
  await require("../src/models/userModel").updateOne({ _id: banned._id }, { $set: { disable: true } });
  assert.equal((await connect({ auth: { token } })).state, "rejected");

  const ghost = jwt.sign({ User: "64b0000000000000000000ff" }, process.env.JWT_SECRET);
  assert.equal((await connect({ auth: { token: ghost } })).state, "rejected", "a token for an account that does not exist");
});

test("a valid token connects (also when sent as an Authorization header)", { skip }, async () => {
  assert.equal((await as(owner)).state, "connected");
  const viaHeader = await connect({ headers: { authorization: `Bearer ${fixtures.tokenFor(owner)}` } });
  assert.equal(viaHeader.state, "connected");
});

test("user rooms: your own only (an admin may join any)", { skip }, async () => {
  const ownerSocket = await as(owner);
  assert.deepEqual(await ownerSocket.emit("joinUserRoom", String(owner._id)), { ok: true });
  assert.deepEqual(await ownerSocket.emit("joinUserRoom", String(stranger._id)), { ok: false });
  assert.deepEqual(await (await as(admin)).emit("joinUserRoom", String(stranger._id)), { ok: true });
});

test("business rooms: the owner and team members, not strangers", { skip }, async () => {
  const room = String(business._id);
  assert.deepEqual(await (await as(owner)).emit("joinBusinessRoom", room), { ok: true });
  assert.deepEqual(await (await as(teammate)).emit("joinBusinessRoom", room), { ok: true });
  assert.deepEqual(await (await as(stranger)).emit("joinBusinessRoom", room), { ok: false });
  assert.deepEqual(await (await as(admin)).emit("joinBusinessRoom", room), { ok: true });
  assert.deepEqual(await (await as(owner)).emit("joinBusinessRoom", "not-an-id"), { ok: false });
  assert.deepEqual(await (await as(owner)).emit("joinBusinessRoom", { $ne: null }), { ok: false });
});

test("conversation and campaign rooms follow the business", { skip }, async () => {
  const conversationId = String(conversation._id);
  const campaignId = String(campaign._id);
  const ownerSocket = await as(owner);
  assert.deepEqual(await ownerSocket.emit("joinConversationRoom", conversationId), { ok: true });
  assert.deepEqual(await ownerSocket.emit("joinCampaignRoom", campaignId), { ok: true });
  assert.deepEqual(await (await as(teammate)).emit("joinConversationRoom", conversationId), { ok: true });

  const strangerSocket = await as(stranger);
  assert.deepEqual(await strangerSocket.emit("joinConversationRoom", conversationId), { ok: false });
  assert.deepEqual(await strangerSocket.emit("joinCampaignRoom", campaignId), { ok: false });
  assert.deepEqual(await ownerSocket.emit("joinConversationRoom", "64b0000000000000000000aa"), { ok: false }, "a room that does not exist");
});

test("messages pushed into a room reach members only", { skip }, async () => {
  const room = String(business._id);
  const member = await as(owner);
  const outsider = await as(stranger);
  await member.emit("joinBusinessRoom", room);
  await outsider.emit("joinBusinessRoom", room);

  io.to(`business:${room}`).emit("newWhatsAppMessage", { text: "customer message" });
  assert.deepEqual(await member.next("newWhatsAppMessage"), [{ text: "customer message" }]);
  assert.equal(await outsider.next("newWhatsAppMessage"), null, "the refused socket hears nothing");
});

test("the chat relay only speaks into rooms the sender is in", { skip }, async () => {
  const room = String(business._id);
  const member = await as(owner);
  await member.emit("joinBusinessRoom", room);
  const outsider = await as(stranger);

  outsider.send("sendMessage", { businessId: room, text: "forged" });
  assert.equal(await member.next("newWhatsAppMessage"), null, "an outsider cannot inject into the room");

  const teammateSocket = await as(teammate);
  await teammateSocket.emit("joinBusinessRoom", room);
  teammateSocket.send("sendMessage", { businessId: room, text: "from a member" });
  assert.deepEqual(await member.next("newWhatsAppMessage"), [{ businessId: room, text: "from a member" }]);
});
