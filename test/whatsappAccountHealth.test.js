const { test } = require("node:test");
const assert = require("node:assert/strict");
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || "ab".repeat(32);
const { handleHealthChange, limitLabel } = require("../src/services/whatsappAccountHealthService");

const account = { _id: "acc-1", userId: "user-1", wabaId: "waba-1", phoneNumberId: "pn-1", phoneNumber: "+91 70502 34325" };

function mocks({ accounts = [account], matched = 1, quality = "YELLOW" } = {}) {
  const calls = { updates: [], notices: [], emits: [] };
  const deps = {
    Account: {
      find: (q) => ({ limit: async () => accounts.filter((a) => a.wabaId === q.wabaId) }),
      updateOne: async (filter, update) => {
        calls.updates.push({ filter, update });
        return { matchedCount: matched };
      },
    },
    notify: async (n) => calls.notices.push(n),
    fetchQuality: async () => {
      if (quality instanceof Error) throw quality;
      return quality;
    },
    io: () => ({ to: (room) => ({ emit: (name, payload) => calls.emits.push({ room, name, payload }) }) }),
  };
  return { deps, calls };
}

test("limit downgrade stores the new tier, refreshes quality and alerts the owner", async () => {
  const { deps, calls } = mocks();
  const value = { display_phone_number: "917050234325", event: "DOWNGRADE", current_limit: "TIER_250" };
  const result = await handleHealthChange({ wabaId: "waba-1", field: "phone_number_quality_update", value }, deps);

  assert.equal(result.applied, true);
  const { $set, $push } = calls.updates[0].update;
  assert.equal($set.messagingLimit, "TIER_250");
  assert.equal($set.qualityEvent, "DOWNGRADE");
  assert.equal($set.qualityRating, "YELLOW");
  assert.equal($push.healthEvents.$slice, -20);
  assert.equal(calls.notices.length, 1);
  assert.equal(calls.notices[0].userId, "user-1");
  assert.match(calls.notices[0].message, /250 business-initiated/);
  assert.equal(calls.notices[0].metadata.severity, "CRITICAL");
  assert.deepEqual(calls.emits.map((e) => [e.room, e.name]), [["user:user-1", "whatsappAccountHealth"]]);
});

test("quality events for another number on the same WABA are ignored", async () => {
  const { deps, calls } = mocks();
  const value = { display_phone_number: "919999999999", event: "FLAGGED" };
  const result = await handleHealthChange({ wabaId: "waba-1", field: "phone_number_quality_update", value }, deps);
  assert.equal(result.skipped, "mapping");
  assert.equal(calls.updates.length + calls.notices.length, 0);
});

test("a WABA mapped to two tenants never leaks alerts", async () => {
  const { deps, calls } = mocks({ accounts: [account, { ...account, _id: "acc-2", userId: "user-2", phoneNumber: null }] });
  const result = await handleHealthChange({ wabaId: "waba-1", field: "account_review_update", value: { decision: "REJECTED" } }, deps);
  assert.equal(result.skipped, "mapping");
  assert.equal(calls.notices.length, 0);
});

test("a retried webhook inside the dedup window does not notify twice", async () => {
  const { deps, calls } = mocks({ matched: 0 });
  const result = await handleHealthChange({ wabaId: "waba-1", field: "account_review_update", value: { decision: "REJECTED" } }, deps);
  assert.equal(result.skipped, "duplicate");
  assert.ok(calls.updates[0].filter.healthEvents.$not.$elemMatch.key);
  assert.equal(calls.notices.length + calls.emits.length, 0);
});

test("account review decision is stored and rejection is notified", async () => {
  const { deps, calls } = mocks();
  await handleHealthChange({ wabaId: "waba-1", field: "account_review_update", value: { decision: "REJECTED" } }, deps);
  assert.equal(calls.updates[0].update.$set.accountReviewStatus, "REJECTED");
  assert.match(calls.notices[0].title, /rejected/);

  const pending = mocks();
  await handleHealthChange({ wabaId: "waba-1", field: "account_review_update", value: { decision: "PENDING" } }, pending.deps);
  assert.equal(pending.calls.updates[0].update.$set.accountReviewStatus, "PENDING");
  assert.equal(pending.calls.notices.length, 0);
});

test("only active warning or critical Meta alerts notify", async () => {
  const alert = (alert_severity, alert_status) => ({
    entity_type: "WABA",
    entity_id: "waba-1",
    alert_info: { alert_severity, alert_status, alert_type: "OBA_REJECTED", alert_description: "Official business account request rejected." },
  });

  const critical = mocks();
  await handleHealthChange({ wabaId: "waba-1", field: "account_alerts", value: alert("CRITICAL", "ACTIVE") }, critical.deps);
  assert.equal(critical.calls.notices[0].message, "Official business account request rejected.");
  assert.equal(critical.calls.updates[0].update.$push.healthEvents.$each[0].event, "OBA_REJECTED");

  const info = mocks();
  await handleHealthChange({ wabaId: "waba-1", field: "account_alerts", value: alert("INFORMATIONAL", "ACTIVE") }, info.deps);
  const resolved = mocks();
  await handleHealthChange({ wabaId: "waba-1", field: "account_alerts", value: alert("CRITICAL", "NONE") }, resolved.deps);
  assert.equal(info.calls.notices.length + resolved.calls.notices.length, 0);
  assert.equal(info.calls.updates.length, 1);
});

test("a failed quality refresh still records the event", async () => {
  const { deps, calls } = mocks({ quality: new Error("token expired") });
  const value = { display_phone_number: "917050234325", event: "FLAGGED" };
  const result = await handleHealthChange({ wabaId: "waba-1", field: "phone_number_quality_update", value }, deps);
  assert.equal(result.applied, true);
  assert.equal(calls.updates[0].update.$set.qualityRating, undefined);
  assert.equal(calls.notices.length, 1);
});

test("messaging limit tiers read as plain numbers", () => {
  assert.equal(limitLabel("TIER_1K"), "1,000 business-initiated conversations per 24 hours");
  assert.equal(limitLabel("TIER_100K"), "1,00,000 business-initiated conversations per 24 hours");
  assert.equal(limitLabel("TIER_UNLIMITED"), "unlimited");
  assert.equal(limitLabel(""), null);
});
