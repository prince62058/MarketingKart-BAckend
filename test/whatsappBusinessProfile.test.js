// Business profile / commerce / calling settings: input checks without a database,
// and sign-in + "connect first" behaviour against the real app with a throwaway mongod.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let alice;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  const fixtures = require("./helpers/securityFixtures");
  alice = fixtures.tokenFor(await fixtures.makeUser({ name: "Alice" }));
});

after(async () => {
  if (h) await h.close();
});

test("profile input is trimmed and checked against WhatsApp's limits", () => {
  const { cleanProfile } = require("../src/services/whatsappBusinessProfileService");
  assert.deepEqual(cleanProfile({ about: "  Hi there ", websites: [" https://a.com ", ""], vertical: "retail" }), { about: "Hi there", websites: ["https://a.com"], vertical: "RETAIL" });
  assert.deepEqual(cleanProfile({ email: "" }), { email: "" });
  assert.throws(() => cleanProfile({ about: "" }), /About can't be empty/);
  assert.throws(() => cleanProfile({ about: "x".repeat(140) }), /at most 139/);
  assert.throws(() => cleanProfile({ email: "not-an-email" }), /valid email/);
  assert.throws(() => cleanProfile({ websites: ["https://a.com", "https://b.com", "https://c.com"] }), /at most 2/);
  assert.throws(() => cleanProfile({ websites: ["a.com"] }), /full website link/);
  assert.throws(() => cleanProfile({ vertical: "SPACESHIPS" }), /category/);
});

test("business profile routes need a sign-in", { skip }, async () => {
  for (const [method, path] of [["GET", "/api/whatsapp/business-profile"], ["PUT", "/api/whatsapp/business-profile"], ["GET", "/api/whatsapp/business-profile/commerce"], ["PUT", "/api/whatsapp/business-profile/calling"]]) {
    const r = await h.call(method, path, { body: method === "PUT" ? {} : undefined });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test("without a connected number the routes say to connect first", { skip }, async () => {
  for (const [method, path, body] of [["GET", "/api/whatsapp/business-profile"], ["GET", "/api/whatsapp/business-profile/commerce"], ["GET", "/api/whatsapp/business-profile/calling"], ["PUT", "/api/whatsapp/business-profile/calling", { enabled: true }]]) {
    const r = await h.call(method, path, { token: alice, body });
    assert.equal(r.status, 409, `${method} ${path}`);
    assert.match(r.body.message, /Connect your WhatsApp number/);
  }
  const bad = await h.call("PUT", "/api/whatsapp/business-profile", { token: alice, body: { about: "" } });
  assert.equal(bad.status, 400);
});
