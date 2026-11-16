// WhatsApp Flows: the form builder, the Meta calls behind it, sending a flow in chat and reading
// the answers. Everything Meta or the database would do is a fake; no network, no database.
const { test } = require("node:test");
const assert = require("node:assert/strict");
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || "ab".repeat(32);
const builder = require("../src/services/whatsappFlowBuilder");
const flows = require("../src/services/whatsappFlowService");

const USER = "64b0000000000000000000a1";
const OTHER_USER = "64b0000000000000000000a2";
const FLOW_ID = "64b0000000000000000000f1";
const CONV_ID = "64b0000000000000000000c1";
const NOW = new Date("2026-11-16T12:00:00Z");
const ACCOUNT = { _id: "acc-1", userId: USER, wabaId: "waba-1", phoneNumberId: "pn-1", accessToken: "token-1", status: "CONNECTED" };

// A thenable query that ignores select/sort/limit/skip, like a Mongoose query that resolves to `value`.
const query = (value) => {
  const q = { select: () => q, sort: () => q, limit: () => q, skip: () => q, lean: () => q };
  q.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  return q;
};

const matches = (row, q) =>
  Object.entries(q).every(([key, want]) => {
    if (want && typeof want === "object" && "$nin" in want) return !want.$nin.includes(row[key]);
    return String(row[key]) === String(want);
  });

function setup({ account = ACCOUNT, rows = [], graph = {}, conversation = null, owned = true, send } = {}) {
  const calls = { graph: [], sent: [], messages: [], emits: [], responses: [], convUpdates: [] };
  const store = rows.map((r) => ({ ...r }));
  let seq = 0;
  const deps = {
    Account: {
      findOne: async (q) => (account && matches(account, q) ? account : null),
    },
    Flow: {
      findOne: async (q) => store.find((r) => matches(r, q)) || null,
      find: (q) => query(store.filter((r) => matches(r, q))),
      create: async (doc) => {
        const row = { _id: `64b00000000000000000ff${String(++seq).padStart(2, "0")}`, ...doc };
        store.push(row);
        return row;
      },
      findOneAndUpdate: async (q, update) => {
        const row = store.find((r) => matches(r, q));
        if (row) Object.assign(row, update.$set);
        return row || null;
      },
      updateOne: async (q, update) => {
        const row = store.find((r) => matches(r, q));
        if (row) {
          Object.assign(row, update.$set || {});
          for (const [k, v] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + v;
        }
        return { matchedCount: row ? 1 : 0 };
      },
      deleteOne: async (q) => {
        const i = store.findIndex((r) => matches(r, q));
        if (i >= 0) store.splice(i, 1);
        return { deletedCount: i >= 0 ? 1 : 0 };
      },
      deleteMany: async (q) => {
        const before = store.length;
        for (let i = store.length - 1; i >= 0; i -= 1) if (matches(store[i], q)) store.splice(i, 1);
        return { deletedCount: before - store.length };
      },
    },
    FlowResponse: {
      create: async (doc) => {
        if (calls.responses.some((r) => r.wamid === doc.wamid)) throw Object.assign(new Error("dup"), { code: 11000 });
        calls.responses.push(doc);
        return doc;
      },
    },
    graph: {
      get: async (path, token, params) => {
        calls.graph.push(["GET", path, params, token]);
        return graph.get ? graph.get(path, params) : {};
      },
      post: async (path, token, body) => {
        calls.graph.push(["POST", path, body, token]);
        return graph.post ? graph.post(path, body) : { success: true };
      },
      upload: async (path, token, json) => {
        calls.graph.push(["UPLOAD", path, json, token]);
        return graph.upload ? graph.upload(path, json) : { success: true, validation_errors: [] };
      },
      del: async (path, token) => {
        calls.graph.push(["DELETE", path, null, token]);
        return graph.del ? graph.del(path) : { success: true };
      },
    },
    Conversation: {
      findById: async (id) => (conversation && String(conversation._id) === String(id) ? conversation : null),
      updateOne: async (q, update) => calls.convUpdates.push({ q, update }),
    },
    Business: { findOne: () => query(owned ? { _id: "biz-1" } : null) },
    Message: {
      create: async (doc) => {
        calls.messages.push(doc);
        return { _id: "msg-1", ...doc };
      },
    },
    sendInteractive: async (to, interactive, credentials) => {
      calls.sent.push({ to, interactive, credentials });
      if (send) return send();
      return { messages: [{ id: "wamid.out" }] };
    },
    io: () => ({ to: (room) => ({ emit: (name) => calls.emits.push([room, name]) }) }),
    now: () => NOW,
  };
  return { deps, calls, store };
}

const leadDefinition = () => builder.starter("LEAD_FORM").definition;
const savedFlow = (extra = {}) => ({
  _id: FLOW_ID,
  userId: USER,
  wabaId: "waba-1",
  metaFlowId: "1673152217594150",
  name: "Lead form",
  categories: ["LEAD_GENERATION"],
  status: "DRAFT",
  definition: leadDefinition(),
  validationErrors: [],
  ...extra,
});

const rejects = (promise, status, code) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.status, status);
    if (code) assert.equal(err.code, code);
    return true;
  });

// ---------- builder ----------

test("a two-screen form navigates, then completes with every answer", () => {
  const { definition, errors } = builder.normalizeDefinition(builder.starter("PURCHASE_INTEREST").definition);
  assert.deepEqual(errors, []);
  const json = builder.buildFlowJson(definition);

  assert.equal(json.version, "7.3");
  assert.deepEqual(json.screens.map((s) => s.id), ["SCREEN_A", "SCREEN_B"]);
  assert.equal(json.screens[0].terminal, undefined);
  assert.equal(json.screens[1].terminal, true);
  assert.equal(json.screens[1].success, true);

  const firstFooter = json.screens[0].layout.children.at(-1);
  assert.deepEqual(firstFooter["on-click-action"], { name: "navigate", next: { type: "screen", name: "SCREEN_B" }, payload: {} });

  const done = json.screens[1].layout.children.at(-1)["on-click-action"];
  assert.equal(done.name, "complete");
  assert.equal(done.payload.choose_a_product, "${screen.SCREEN_A.form.choose_a_product}");
  assert.equal(done.payload.full_name, "${form.full_name}");

  const radio = json.screens[0].layout.children.find((c) => c.type === "RadioButtonsGroup");
  assert.deepEqual(radio["data-source"][0], { id: "product_a", title: "Product A" });
  const phone = json.screens[1].layout.children.find((c) => c.name === "phone_number");
  assert.equal(phone.type, "TextInput");
  assert.equal(phone["input-type"], "phone");
});

test("every starter is a valid form", () => {
  for (const s of builder.STARTERS) {
    assert.deepEqual(builder.normalizeDefinition(s.definition).errors, [], s.key);
  }
});

test("the builder enforces Meta's limits and reports where", () => {
  const { errors } = builder.normalizeDefinition({
    screens: [
      {
        title: "Form",
        fields: [
          { type: "text", label: "This label is far too long for Meta" },
          { type: "dropdown", label: "Pick", options: ["A", "a"] },
          { type: "radio", label: "Choose", options: [] },
          { type: "rocket", label: "x" },
        ],
      },
    ],
  });
  const paths = errors.map((e) => e.path);
  assert.ok(paths.includes("screens[0].fields[0].label"));
  assert.ok(paths.includes("screens[0].fields[1].options[1]"));
  assert.ok(paths.includes("screens[0].fields[2].options"));
  assert.ok(paths.includes("screens[0].fields[3].type"));
  assert.deepEqual(builder.normalizeDefinition({ screens: [] }).errors.map((e) => e.path), ["screens"]);
});

test("field names and option ids stay the same when a form is edited", () => {
  const first = builder.normalizeDefinition(builder.starter("LEAD_FORM").definition).definition;
  first.screens[0].fields[0].label = "Your name";
  first.screens[0].fields.push({ type: "text", label: "नाम" });
  const again = builder.normalizeDefinition(first).definition;
  assert.equal(again.screens[0].fields[0].name, "full_name");
  assert.deepEqual(again.screens[0].fields[3].options, first.screens[0].fields[3].options);
  assert.equal(again.screens[0].fields[4].name, "field");
});

test("answers come back with labels and option titles", () => {
  const definition = leadDefinition();
  const answers = builder.describeAnswers(definition, {
    flow_token: "mkf_1",
    full_name: "Asha",
    interested_in: "pricing",
    consent: true,
    extra_note: "hello",
  });
  assert.deepEqual(answers, [
    { key: "full_name", label: "Full name", value: "Asha" },
    { key: "interested_in", label: "Interested in", value: "Pricing" },
    { key: "consent", label: "Consent", value: "Yes" },
    { key: "extra_note", label: "Extra note", value: "hello" },
  ]);
});

// ---------- Meta calls ----------

test("creating a flow sends its JSON to the user's WABA and keeps it as a draft", async () => {
  const errorsFromMeta = [{ error: "INVALID_PROPERTY", message: "x" }];
  const { deps, calls, store } = setup({ graph: { post: () => ({ id: "999", success: true, validation_errors: errorsFromMeta }) } });
  const flow = await flows.createFlow(USER, { name: "  Diwali leads ", starter: "LEAD_FORM" }, deps);

  const [method, path, body, token] = calls.graph[0];
  assert.equal(method, "POST");
  assert.equal(path, "/waba-1/flows");
  assert.equal(token, "token-1");
  assert.equal(body.name, "Diwali leads");
  assert.deepEqual(body.categories, ["LEAD_GENERATION"]);
  assert.equal(JSON.parse(body.flow_json).screens[0].id, "SCREEN_A");

  assert.equal(flow.status, "DRAFT");
  assert.equal(flow.metaFlowId, "999");
  assert.equal(flow.editable, true);
  assert.deepEqual(flow.validationErrors, errorsFromMeta);
  assert.equal(store[0].userId, USER);
  assert.equal(store[0].wabaId, "waba-1");
});

test("a broken form or a missing connection never reaches Meta", async () => {
  const bad = setup();
  await rejects(flows.createFlow(USER, { name: "x", categories: ["OTHER"], definition: { screens: [] } }, bad.deps), 400, "INVALID_FORM");
  await rejects(flows.createFlow(USER, { name: "x", categories: ["NOPE"], starter: "BLANK" }, bad.deps), 400, "INVALID_CATEGORY");
  await rejects(flows.createFlow(USER, { name: "", starter: "BLANK" }, bad.deps), 400, "INVALID_NAME");
  assert.equal(bad.calls.graph.length, 0);

  const offline = setup({ account: null });
  await rejects(flows.createFlow(USER, { name: "x", starter: "BLANK" }, offline.deps), 409, "WHATSAPP_NOT_CONNECTED");
  assert.equal(offline.calls.graph.length, 0);
});

test("editing uploads flow.json, and an edited published flow is a draft again", async () => {
  const { deps, calls } = setup({
    rows: [savedFlow({ status: "PUBLISHED" })],
    graph: { get: () => ({ id: "1673152217594150", status: "DRAFT" }) },
  });
  const definition = leadDefinition();
  definition.screens[0].heading = "New heading";
  const flow = await flows.updateFlow(USER, FLOW_ID, { definition }, deps);

  const upload = calls.graph.find((c) => c[0] === "UPLOAD");
  assert.equal(upload[1], "/1673152217594150/assets");
  assert.equal(upload[2].screens[0].layout.children[0].text, "New heading");
  assert.equal(flow.status, "DRAFT");
});

test("flows from WhatsApp Manager and other users' flows cannot be edited here", async () => {
  const imported = setup({ rows: [savedFlow({ definition: null, source: "META" })] });
  await rejects(flows.updateFlow(USER, FLOW_ID, { definition: leadDefinition() }, imported.deps), 409, "NOT_EDITABLE");
  const foreign = setup({ rows: [savedFlow({ userId: OTHER_USER })] });
  await rejects(flows.updateFlow(USER, FLOW_ID, { name: "mine now" }, foreign.deps), 404, "FLOW_NOT_FOUND");
  await rejects(flows.getFlow(USER, "not-an-id", foreign.deps), 404, "FLOW_NOT_FOUND");
  assert.equal(imported.calls.graph.length + foreign.calls.graph.length, 0);
});

test("publishing waits for a clean flow, then takes Meta's status", async () => {
  const dirty = setup({ rows: [savedFlow({ validationErrors: [{ message: "bad" }] })] });
  await rejects(flows.publishFlow(USER, FLOW_ID, dirty.deps), 400, "FLOW_HAS_ERRORS");
  assert.equal(dirty.calls.graph.length, 0);

  const clean = setup({ rows: [savedFlow()], graph: { get: () => ({ status: "PUBLISHED" }) } });
  const flow = await flows.publishFlow(USER, FLOW_ID, clean.deps);
  assert.deepEqual(clean.calls.graph[0].slice(0, 2), ["POST", "/1673152217594150/publish"]);
  assert.equal(flow.status, "PUBLISHED");
  assert.equal(flow.publishedAt, NOW);
});

test("a preview link is reused until it is close to expiring", async () => {
  const fresh = setup({ rows: [savedFlow({ previewUrl: "https://business.facebook.com/wa/manage/flows/1/preview/?token=a", previewExpiresAt: new Date("2026-12-01T00:00:00Z") })] });
  const cached = await flows.previewFlow(USER, FLOW_ID, fresh.deps);
  assert.match(cached.previewUrl, /token=a/);
  assert.equal(fresh.calls.graph.length, 0);

  const stale = setup({
    rows: [savedFlow()],
    graph: { get: () => ({ preview: { preview_url: "https://business.facebook.com/wa/manage/flows/1/preview/?token=b", expires_at: "2026-12-16T12:00:00+0000" } }) },
  });
  const result = await flows.previewFlow(USER, FLOW_ID, stale.deps);
  assert.deepEqual(stale.calls.graph[0].slice(0, 3), ["GET", "/1673152217594150", { fields: "preview.invalidate(false)" }]);
  assert.match(result.previewUrl, /token=b/);
  assert.equal(result.expiresAt.toISOString(), "2026-12-16T12:00:00.000Z");
});

test("only drafts are deleted, even when Meta already removed them", async () => {
  const published = setup({ rows: [savedFlow({ status: "PUBLISHED" })] });
  await rejects(flows.deleteFlow(USER, FLOW_ID, published.deps), 409, "FLOW_NOT_DRAFT");

  const gone = setup({
    rows: [savedFlow()],
    graph: {
      del: () => {
        throw Object.assign(new Error("Unsupported delete request"), { isMeta: true, metaCode: 100 });
      },
    },
  });
  assert.deepEqual(await flows.deleteFlow(USER, FLOW_ID, gone.deps), { deleted: true });
  assert.equal(gone.store.length, 0);
});

test("sync brings in WhatsApp Manager flows and drops ones deleted there", async () => {
  const { deps, store } = setup({
    rows: [
      savedFlow(),
      savedFlow({ _id: "64b0000000000000000000f2", metaFlowId: "555", name: "Old" }),
      savedFlow({ _id: "64b0000000000000000000f3", metaFlowId: "777", userId: OTHER_USER }),
    ],
    graph: {
      get: () => ({
        data: [
          { id: "1673152217594150", name: "Lead form", status: "PUBLISHED", categories: ["LEAD_GENERATION"] },
          { id: "1710114897438121", name: "Flow 1", status: "DRAFT", categories: ["OTHER"] },
          { id: "777", name: "Not yours", status: "DRAFT" },
        ],
      }),
    },
  });
  const result = await flows.syncFlows(USER, deps);
  assert.deepEqual(result, { added: 1, updated: 1, removed: 1, total: 3 });
  const imported = store.find((r) => r.metaFlowId === "1710114897438121");
  assert.equal(imported.source, "META");
  assert.equal(imported.userId, USER);
  assert.equal(store.find((r) => r.metaFlowId === "1673152217594150").status, "PUBLISHED");
  assert.equal(store.find((r) => r.metaFlowId === "777").userId, OTHER_USER);
});

// ---------- sending and answers ----------

const conversation = { _id: CONV_ID, businessId: "biz-1", phoneNumberId: "pn-1", customerPhone: "919999999999", customerName: "Asha" };

test("a flow goes out in chat with a token that names the flow", async () => {
  const { deps, calls } = setup({ rows: [savedFlow({ status: "PUBLISHED" })], conversation });
  const result = await flows.sendFlow(USER, FLOW_ID, { conversationId: CONV_ID, bodyText: "Fill this", ctaText: "Book now" }, deps);

  const { to, interactive, credentials } = calls.sent[0];
  assert.equal(to, "919999999999");
  assert.equal(credentials.phoneNumberId, "pn-1");
  assert.equal(interactive.type, "flow");
  assert.equal(interactive.body.text, "Fill this");
  assert.deepEqual(interactive.action, {
    name: "flow",
    parameters: {
      flow_message_version: "3",
      flow_token: "mkf_1673152217594150",
      flow_id: "1673152217594150",
      flow_cta: "Book now",
      flow_action: "navigate",
    },
  });
  assert.equal(result.draft, false);
  assert.equal(calls.messages[0].type, "INTERACTIVE");
  assert.equal(calls.messages[0].direction, "OUTBOUND");
  assert.equal(calls.convUpdates.length, 1);
  assert.ok(calls.emits.some(([room]) => room === `conversation:${CONV_ID}`));
});

test("a draft flow is sent in draft mode for testing", async () => {
  const { deps, calls } = setup({ rows: [savedFlow()], conversation });
  const result = await flows.sendFlow(USER, FLOW_ID, { conversationId: CONV_ID }, deps);
  assert.equal(calls.sent[0].interactive.action.parameters.mode, "draft");
  assert.equal(result.draft, true);
});

test("sending refuses other people's chats, other WABAs and a closed reply window", async () => {
  const notMine = setup({ rows: [savedFlow({ status: "PUBLISHED" })], conversation, owned: false });
  await rejects(flows.sendFlow(USER, FLOW_ID, { conversationId: CONV_ID }, notMine.deps), 403, "FORBIDDEN");

  const otherWaba = setup({ rows: [savedFlow({ status: "PUBLISHED", wabaId: "waba-2" })], conversation });
  await rejects(flows.sendFlow(USER, FLOW_ID, { conversationId: CONV_ID }, otherWaba.deps), 409, "WABA_MISMATCH");
  assert.equal(notMine.calls.sent.length + otherWaba.calls.sent.length, 0);

  const closed = setup({
    rows: [savedFlow({ status: "PUBLISHED" })],
    conversation,
    send: () => {
      throw Object.assign(new Error("Re-engagement message"), { code: 131047 });
    },
  });
  await rejects(flows.sendFlow(USER, FLOW_ID, { conversationId: CONV_ID }, closed.deps), 400, "REPLY_WINDOW_CLOSED");
  assert.equal(closed.calls.messages.length, 0);
});

test("a completed flow becomes readable chat text and is stored once", async () => {
  const { deps, calls, store } = setup({ rows: [savedFlow({ status: "PUBLISHED" })] });
  const nfmReply = {
    name: "flow",
    body: "Sent",
    response_json: JSON.stringify({ flow_token: "mkf_1673152217594150", full_name: "Asha", phone_number: "9999999999", interested_in: "pricing" }),
  };
  const described = await flows.describeReply({ userId: USER, wabaId: "waba-1", nfmReply }, deps);
  assert.equal(described.text, "📋 Lead form\nFull name: Asha\nPhone number: 9999999999\nInterested in: Pricing");

  const context = { userId: USER, wamid: "wamid.in", conversationId: CONV_ID, receivedAt: NOW };
  assert.deepEqual(await flows.recordReply(described, context, deps), { recorded: true });
  assert.deepEqual(await flows.recordReply(described, context, deps), { skipped: "duplicate" });
  assert.equal(calls.responses.length, 1);
  assert.equal(calls.responses[0].flowId, FLOW_ID);
  assert.equal(store[0].responseCount, 1);
});

test("a reply to someone else's flow or without our token is still shown, without labels", async () => {
  const { deps } = setup({ rows: [savedFlow({ userId: OTHER_USER })] });
  const reply = { response_json: JSON.stringify({ flow_token: "mkf_1673152217594150", full_name: "Asha" }) };
  const foreign = await flows.describeReply({ userId: USER, wabaId: "waba-1", nfmReply: reply }, deps);
  assert.equal(foreign.flow, null);
  assert.equal(foreign.text, "📋 Form submitted\nFull name: Asha");

  const broken = await flows.describeReply({ userId: USER, wabaId: "waba-1", nfmReply: { response_json: "{not json" } }, deps);
  assert.equal(broken.text, "📋 Form submitted");
  assert.equal(flows.parseReply({ response_json: '{"flow_token":"unused"}' }).metaFlowId, null);
});

test("errors map to answers the app can act on, and never to 401", () => {
  const meta = (code) => Object.assign(new Error("meta says no"), { isMeta: true, metaCode: code });
  assert.deepEqual(flows.toHttp(meta(190)).body.code, "WHATSAPP_TOKEN_INVALID");
  assert.equal(flows.toHttp(meta(200)).body.code, "PERMISSION_MISSING");
  assert.equal(flows.toHttp(meta(10)).status, 409);
  assert.deepEqual(flows.toHttp(meta(100)), { status: 502, body: { success: false, code: "META_ERROR", message: "meta says no" } });
  const cloudError = Object.assign(new Error("x"), { code: 190, response: { data: { error: { code: 190 } } } });
  assert.equal(flows.toHttp(cloudError).body.code, "WHATSAPP_TOKEN_INVALID");
  assert.equal(flows.toHttp(new Error("boom")).status, 500);
  for (const code of [190, 200, 10, 100]) assert.notEqual(flows.toHttp(meta(code)).status, 401);
});
