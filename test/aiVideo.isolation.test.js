// One customer's AI videos, avatars and balance are never visible to, or changeable by, another
// customer. Real app, real routes, real login middleware, throwaway local mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;
let Studio;
let alice;
let bob;
let aliceToken;
let bobToken;
let aliceShop;
let bobShop;

const video = (id, title) => ({ id, title, status: "Completed", format: "9:16", duration: "0:20", presenter: "priya", script: `${title} script`, videoUrl: `https://cdn.test/${id}.mp4`, createdAt: new Date() });
const ids = body => body.data.projects.map(project => project.id);
const studio = (token, business) => h.call("GET", "/api/ai-video/studio", { token, headers: business ? { "x-business-id": String(business) } : {} });

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  Studio = require("../src/modules/aiVideo/aiVideo.model");
  await Studio.init();
  alice = await fixtures.makeUser({ name: "Alice" });
  bob = await fixtures.makeUser({ name: "Bob" });
  [aliceToken, bobToken] = [alice, bob].map(user => fixtures.tokenFor(user));
  aliceShop = await fixtures.makeBusiness(alice, { businessName: "Alice Sweets" });
  bobShop = await fixtures.makeBusiness(bob, { businessName: "Bob Garage" });

  await Studio.create({ userId: alice._id, businessId: String(aliceShop._id), credits: 500, projects: [video("alice-1", "Alice diwali offer")] });
  await Studio.create({ userId: alice._id, businessId: null, credits: 70, projects: [video("alice-personal", "Alice personal")] });
  await Studio.create({ userId: bob._id, businessId: String(bobShop._id), credits: 40, projects: [video("bob-1", "Bob service camp")] });
});

after(async () => {
  if (h) await h.close();
});

test("each customer's studio lists only their own videos and balance", { skip }, async () => {
  const mine = await studio(aliceToken, aliceShop._id);
  assert.equal(mine.status, 200);
  assert.deepEqual(ids(mine.body), ["alice-1"]);
  assert.equal(mine.body.data.credits, 500);

  const theirs = await studio(bobToken, bobShop._id);
  assert.deepEqual(ids(theirs.body), ["bob-1"]);
  assert.equal(theirs.body.data.credits, 40);

  const personal = await studio(aliceToken);
  assert.deepEqual(ids(personal.body), ["alice-personal"]);
  assert.equal(personal.body.data.credits, 70);
});

test("a customer who signs in on the same phone later still sees only their own studio", { skip }, async () => {
  // Switching accounts on one device just sends another token: nothing is shared server side.
  for (const [token, shop, expected] of [[aliceToken, aliceShop, ["alice-1"]], [bobToken, bobShop, ["bob-1"]], [aliceToken, aliceShop, ["alice-1"]]]) {
    assert.deepEqual(ids(await studio(token, shop._id).then(response => response.body)), expected);
  }
});

test("another customer's video cannot be opened or deleted by its id", { skip }, async () => {
  const opened = await h.call("GET", "/api/ai-video/projects/alice-1", { token: bobToken, headers: { "x-business-id": String(bobShop._id) } });
  assert.equal(opened.status, 404);
  assert.equal(opened.body?.data?.videoUrl, undefined);

  const deleted = await h.call("DELETE", "/api/ai-video/projects/alice-1", { token: bobToken, headers: { "x-business-id": String(bobShop._id) } });
  assert.equal(deleted.status, 404);
  const still = await Studio.findOne({ userId: alice._id, businessId: String(aliceShop._id) }).lean();
  assert.deepEqual(still.projects.map(project => project.id), ["alice-1"]);
});

test("naming somebody else's business is refused, and no studio is created for it", { skip }, async () => {
  const before = await Studio.countDocuments();
  const peek = await studio(bobToken, aliceShop._id);
  assert.equal(peek.status, 403);
  assert.equal(peek.body.data, undefined);
  assert.equal(await Studio.countDocuments(), before);

  const create = await h.call("POST", "/api/ai-video/projects", {
    token: bobToken,
    headers: { "x-business-id": String(aliceShop._id) },
    body: { title: "x", prompt: "x", script: "hello there", format: "9:16", presenter: "priya" },
  });
  assert.equal(create.status, 403);
  const aliceStudio = await Studio.findOne({ userId: alice._id, businessId: String(aliceShop._id) }).lean();
  assert.equal(aliceStudio.credits, 500, "nothing was charged to the real owner");
  assert.equal(aliceStudio.projects.length, 1);
});

test("made-up business ids cannot be used to open extra studios", { skip }, async () => {
  const before = await Studio.countDocuments({ userId: bob._id });
  const unknown = await studio(bobToken, "64b0000000000000000000ee");
  assert.equal(unknown.status, 403);
  const garbage = await studio(bobToken, "not-a-business");
  assert.equal(garbage.status, 400);
  assert.equal(await Studio.countDocuments({ userId: bob._id }), before);
});

test("a new account starts with no credits and no videos", { skip }, async () => {
  const carol = await fixtures.makeUser({ name: "Carol" });
  const first = await studio(fixtures.tokenFor(carol));
  assert.equal(first.status, 200);
  assert.equal(first.body.data.credits, 0);
  assert.deepEqual(ids(first.body), []);
});

test("a team member may use the owner's business id but gets their own empty studio, not the owner's videos", { skip }, async () => {
  const member = await fixtures.makeUser({ name: "Team member", userType: "SUBUSER", businessId: [aliceShop._id] });
  const response = await studio(fixtures.tokenFor(member), aliceShop._id);
  assert.equal(response.status, 200);
  assert.deepEqual(ids(response.body), []);
  assert.equal(response.body.data.credits, 0);
});

test("calls that never touch a studio ignore a stale business id instead of failing", { skip }, async () => {
  const response = await h.call("POST", "/api/ai-video/orders/confirm", {
    token: bobToken,
    headers: { "x-business-id": "64b0000000000000000000ee" },
    body: {},
  });
  assert.notEqual(response.status, 403);
  assert.notEqual(response.status, 401);
});

test("no login, no studio", { skip }, async () => {
  const response = await h.call("GET", "/api/ai-video/studio", { headers: { "x-business-id": String(aliceShop._id) } });
  assert.equal(response.status, 401);
});
