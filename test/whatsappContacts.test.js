// WhatsApp panel contacts, groups and custom fields: run against the real app and a throwaway mongod.
// The pure helpers are tested without a database.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");

const skip = !hasMongod;
let h;
let alice;
let bob;

before(async () => {
  if (skip) return;
  h = await bootSecurityHarness();
  const fixtures = require("./helpers/securityFixtures");
  for (const name of ["whatsappContact", "whatsappContactGroup", "whatsappContactField"]) {
    await require("mongoose").models[name]?.syncIndexes();
  }
  alice = fixtures.tokenFor(await fixtures.makeUser({ name: "Alice" }));
  bob = fixtures.tokenFor(await fixtures.makeUser({ name: "Bob" }));
});

after(async () => {
  if (h) await h.close();
});

test("phone numbers are normalised the same way campaigns send them", () => {
  const { normalizePhone, fieldKey, cleanCustom } = require("../src/services/whatsappContactService");
  assert.equal(normalizePhone("98765 43210"), "919876543210");
  assert.equal(normalizePhone("+91-98765-43210"), "919876543210");
  assert.equal(normalizePhone("14155550123"), "14155550123");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(fieldKey(" Renewal Date! "), "renewal_date");
  assert.deepEqual(cleanCustom({ city: " Pune ", hack: "x", plan: "" }, [{ key: "city" }, { key: "plan" }]), { city: "Pune" });
});

test("contacts need a sign-in", { skip }, async () => {
  for (const [method, path] of [["GET", "/api/whatsapp/contacts"], ["GET", "/api/whatsapp/contact-groups"], ["GET", "/api/whatsapp/contact-fields"], ["POST", "/api/whatsapp/contacts/import"]]) {
    const r = await h.call(method, path, { body: method === "POST" ? {} : undefined });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test("a customer adds, edits, filters and deletes their own contacts", { skip }, async () => {
  const field = await h.call("POST", "/api/whatsapp/contact-fields", { token: alice, body: { name: "City", type: "Text" } });
  assert.equal(field.status, 201);
  assert.equal(field.body.data.key, "city");
  const reserved = await h.call("POST", "/api/whatsapp/contact-fields", { token: alice, body: { name: "Phone" } });
  assert.equal(reserved.status, 409);

  const group = await h.call("POST", "/api/whatsapp/contact-groups", { token: alice, body: { name: "VIP", keywords: ["vip", "vip", " "] } });
  assert.equal(group.status, 201);
  assert.deepEqual(group.body.data.keywords, ["vip"]);
  const groupId = group.body.data._id;

  const made = await h.call("POST", "/api/whatsapp/contacts", { token: alice, body: { name: "Rahul", phone: "9876543210", groups: [groupId], custom: { city: "Pune", secret: "no" } } });
  assert.equal(made.status, 201);
  assert.equal(made.body.data.phone, "919876543210");
  assert.deepEqual(made.body.data.groups, [groupId]);
  assert.deepEqual(made.body.data.custom, { city: "Pune" });

  const dup = await h.call("POST", "/api/whatsapp/contacts", { token: alice, body: { phone: "+91 98765 43210" } });
  assert.equal(dup.status, 409);
  const bad = await h.call("POST", "/api/whatsapp/contacts", { token: alice, body: { phone: "123" } });
  assert.equal(bad.status, 400);

  const second = await h.call("POST", "/api/whatsapp/contacts", { token: alice, body: { name: "Amit", phone: "919812345678" } });
  const edited = await h.call("PUT", `/api/whatsapp/contacts/${second.body.data._id}`, { token: alice, body: { name: "Amit K", subscribed: false } });
  assert.equal(edited.body.data.name, "Amit K");
  assert.equal(edited.body.data.subscribed, false);

  const inGroup = await h.call("GET", `/api/whatsapp/contacts?group=${groupId}`, { token: alice });
  assert.equal(inGroup.body.total, 1);
  const searched = await h.call("GET", "/api/whatsapp/contacts?search=amit", { token: alice });
  assert.equal(searched.body.data[0].name, "Amit K");
  const regexy = await h.call("GET", "/api/whatsapp/contacts?search=(.*", { token: alice });
  assert.equal(regexy.status, 200);
  const unsub = await h.call("GET", "/api/whatsapp/contacts?status=unsub", { token: alice });
  assert.equal(unsub.body.total, 1);

  const groups = await h.call("GET", "/api/whatsapp/contact-groups", { token: alice });
  assert.equal(groups.body.data[0].contactCount, 1);

  const audience = await h.call("POST", "/api/whatsapp/contacts/audience", { token: alice, body: { groups: [groupId] } });
  assert.deepEqual(audience.body.data, [{ city: "Pune", phone: "919876543210", name: "Rahul" }]);

  const removed = await h.call("DELETE", `/api/whatsapp/contacts/${second.body.data._id}`, { token: alice });
  assert.equal(removed.status, 200);
  const gone = await h.call("DELETE", `/api/whatsapp/contacts/${second.body.data._id}`, { token: alice });
  assert.equal(gone.status, 404);
});

test("import skips saved numbers and repeats, counts invalid rows, and adds to the group", { skip }, async () => {
  const group = await h.call("POST", "/api/whatsapp/contact-groups", { token: alice, body: { name: "Leads" } });
  const groupId = group.body.data._id;
  const r = await h.call("POST", "/api/whatsapp/contacts/import", {
    token: alice,
    body: {
      groupId,
      contacts: [
        { name: "Rahul again", phone: "919876543210" },
        { name: "New One", phone: "9000000001", custom: { city: "Delhi" } },
        { name: "Repeat", phone: "919000000001" },
        { name: "Bad", phone: "12" },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { added: 1, skipped: 2, invalid: 1 });
  const other = await h.call("POST", "/api/whatsapp/contact-groups", { token: alice, body: { name: "Browser" } });
  const bobGroup = await h.call("POST", "/api/whatsapp/contact-groups", { token: bob, body: { name: "Bob only" } });
  const moved = await h.call("POST", "/api/whatsapp/contacts/import", {
    token: alice,
    body: { contacts: [{ phone: "919000000002", groups: [other.body.data._id, bobGroup.body.data._id], source: "Direct" }] },
  });
  assert.deepEqual(moved.body.data, { added: 1, skipped: 0, invalid: 0 });
  const inOther = await h.call("GET", `/api/whatsapp/contacts?group=${other.body.data._id}`, { token: alice });
  assert.deepEqual(inOther.body.data[0].groups, [other.body.data._id], "another owner's group id is dropped");
  assert.equal(inOther.body.data[0].source, "Direct");
  const leads = await h.call("GET", `/api/whatsapp/contacts?group=${groupId}`, { token: alice });
  assert.equal(leads.body.total, 2, "the existing number joins the group too");
  const fresh = leads.body.data.find((c) => c.phone === "919000000001");
  assert.equal(fresh.source, "Imported");
  assert.deepEqual(fresh.custom, { city: "Delhi" });
});

test("bulk actions and group deletion only touch the caller's rows", { skip }, async () => {
  const mine = await h.call("GET", "/api/whatsapp/contacts", { token: alice });
  const ids = mine.body.data.map((c) => c._id);
  const bobView = await h.call("GET", "/api/whatsapp/contacts", { token: bob });
  assert.equal(bobView.body.total, 0);

  const bobDelete = await h.call("POST", "/api/whatsapp/contacts/bulk", { token: bob, body: { ids, action: "delete" } });
  assert.equal(bobDelete.body.data.changed, 0);
  const bobEdit = await h.call("PUT", `/api/whatsapp/contacts/${ids[0]}`, { token: bob, body: { name: "pwned" } });
  assert.equal(bobEdit.status, 404);

  const aliceGroups = await h.call("GET", "/api/whatsapp/contact-groups", { token: alice });
  const vip = aliceGroups.body.data.find((g) => g.name === "VIP");
  const bobAudience = await h.call("POST", "/api/whatsapp/contacts/audience", { token: bob, body: { groups: [vip._id] } });
  assert.deepEqual(bobAudience.body.data, []);
  const bobGroupDelete = await h.call("DELETE", `/api/whatsapp/contact-groups/${vip._id}`, { token: bob });
  assert.equal(bobGroupDelete.status, 404);

  const unsub = await h.call("POST", "/api/whatsapp/contacts/bulk", { token: alice, body: { ids, action: "unsubscribe" } });
  assert.equal(unsub.body.data.changed, ids.length);
  const noAudience = await h.call("POST", "/api/whatsapp/contacts/audience", { token: alice, body: { groups: [vip._id] } });
  assert.deepEqual(noAudience.body.data, [], "unsubscribed contacts are left out of campaigns");

  const del = await h.call("DELETE", `/api/whatsapp/contact-groups/${vip._id}`, { token: alice });
  assert.equal(del.status, 200);
  const after = await h.call("GET", "/api/whatsapp/contacts", { token: alice });
  assert.equal(after.body.total, ids.length, "contacts stay when only the group is deleted");
  assert.equal(after.body.data.some((c) => c.groups.includes(vip._id)), false);

  const fields = await h.call("GET", "/api/whatsapp/contact-fields", { token: alice });
  const city = fields.body.data.find((f) => f.key === "city");
  await h.call("DELETE", `/api/whatsapp/contact-fields/${city._id}`, { token: alice });
  const stripped = await h.call("GET", "/api/whatsapp/contacts", { token: alice });
  assert.equal(stripped.body.data.some((c) => c.custom.city), false);
});
