// The WhatsApp panel's brands live on the server, so signing in on another browser finds them.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
let h;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
});

after(async () => {
  if (h) await h.close();
});

test("a new account starts from the businesses it already runs", { skip }, async () => {
  const owner = await fixtures.makeUser();
  const biz = await fixtures.makeBusiness(owner, { businessName: "Prince Tech" });
  await fixtures.makeBusiness(owner, { businessName: "Old Shop", disable: true });
  const res = await h.call("GET", "/api/whatsapp/panel/brands", { token: fixtures.tokenFor(owner) });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.data.brands.map((b) => b.name), ["Prince Tech"]);
  assert.equal(res.body.data.brands[0].id, String(biz._id));
  assert.equal(res.body.data.currentId, String(biz._id));
});

test("saved brands come back on the next sign-in, and only to their owner", { skip }, async () => {
  const owner = await fixtures.makeUser();
  const token = fixtures.tokenFor(owner);
  const first = await h.call("GET", "/api/whatsapp/panel/brands", { token });
  assert.deepEqual(first.body.data.brands, [], "no business, no brands yet");

  const saved = await h.call("PUT", "/api/whatsapp/panel/brands", {
    token,
    body: { brands: [{ id: "abc123def456", name: "My Brand", timezone: "Asia/Kolkata" }], currentId: "abc123def456" },
  });
  assert.equal(saved.status, 200, saved.text);

  const again = await h.call("GET", "/api/whatsapp/panel/brands", { token });
  assert.equal(again.body.data.brands[0].name, "My Brand");
  assert.equal(again.body.data.currentId, "abc123def456");

  const other = await fixtures.makeUser();
  const theirs = await h.call("GET", "/api/whatsapp/panel/brands", { token: fixtures.tokenFor(other) });
  assert.deepEqual(theirs.body.data.brands, []);
  assert.equal((await h.call("GET", "/api/whatsapp/panel/brands")).status, 401);
});

test("bad brand lists are refused and a brand cannot point at someone else's business", { skip }, async () => {
  const owner = await fixtures.makeUser();
  const token = fixtures.tokenFor(owner);
  const stranger = await fixtures.makeUser();
  const theirBiz = await fixtures.makeBusiness(stranger, { businessName: "Not yours" });

  const bad = await h.call("PUT", "/api/whatsapp/panel/brands", { token, body: { brands: [{ id: "x", name: "" }] } });
  assert.equal(bad.status, 400);
  const tooMany = await h.call("PUT", "/api/whatsapp/panel/brands", {
    token,
    body: { brands: Array.from({ length: 51 }, (_, i) => ({ id: `brand${String(i).padStart(4, "0")}`, name: `B${i}` })) },
  });
  assert.equal(tooMany.status, 400);

  const res = await h.call("PUT", "/api/whatsapp/panel/brands", {
    token,
    body: { brands: [{ id: "mine000001", name: "Mine", businessId: String(theirBiz._id) }], currentId: "nope" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.brands[0].businessId, null);
  assert.equal(res.body.data.currentId, "mine000001");
});
