// Conversions API for Business Messaging (WhatsApp): the click-id capture, the at-most-once report of
// LeadSubmitted / Purchase events, and the dataset lookup. Every model and the Graph API are fakes,
// so this never touches a database or the network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY || "ab".repeat(32);
const conversions = require("../src/services/whatsappConversionService");
const {
  extractCtwaReferral,
  captureReferral,
  getOrCreateDataset,
  markConversation,
  getConversionState,
  describeGraphError,
  LOCK_MS,
} = conversions;

const NOW = new Date("2026-11-16T12:00:00Z");
const WABA = "1029384756";
const CLID = "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv";
const ids = {
  user: "64b0000000000000000000aa",
  otherUser: "64b0000000000000000000bb",
  business: "64b0000000000000000000c1",
  conversation: "64b0000000000000000000d1",
  account: "64b0000000000000000000e1",
  event: "64b0000000000000000000f1",
};

// An inbound message sent from a Click-to-WhatsApp ad, in the shape of Meta's messages webhook.
const adMessage = {
  from: "919876543210",
  id: "wamid.TEST1",
  timestamp: "1763290000",
  type: "text",
  text: { body: "Is this still available?" },
  referral: {
    source_url: "https://fb.me/example",
    source_id: "120000000000001",
    source_type: "ad",
    headline: "Diwali offer",
    body: "Flat 20% off this week",
    media_type: "image",
    image_url: "https://scontent.example/ad.jpg",
    ctwa_clid: CLID,
    welcome_message: { text: "Hi! How can we help?" },
  },
};

const baseConversation = (overrides = {}) => ({
  _id: ids.conversation,
  businessId: ids.business,
  wabaId: WABA,
  phoneNumberId: "5550001",
  customerPhone: "919876543210",
  ctwa: {
    clid: CLID,
    adId: "120000000000001",
    sourceType: "ad",
    headline: "Diwali offer",
    mediaType: "image",
    capturedAt: new Date("2026-11-15T10:00:00Z"),
  },
  ...overrides,
});

const baseAccount = (overrides = {}) => ({
  _id: ids.account,
  userId: ids.user,
  wabaId: WABA,
  phoneNumberId: "5550001",
  status: "CONNECTED",
  accessToken: "business-token",
  capiDataset: { datasetId: "777000111", wabaId: WABA },
  ...overrides,
});

// A Mongoose query stand-in: any chain of select()/lean(), resolved when awaited.
const query = (value) => {
  const q = { select: () => q, lean: () => q, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) };
  return q;
};

const metaError = (code, message, status = 400) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error: { message, type: "OAuthException", code, fbtrace_id: "trace-err" } } },
  });

// One tenant with one ad chat, a connected account, the conversion-event collection and the Graph API.
function world(options = {}) {
  const opts = { firstTouchFree: true, ...options };
  const conversation = "conversation" in opts ? opts.conversation : baseConversation();
  const account = "account" in opts ? opts.account : baseAccount();
  let row = opts.existing ? { ...opts.existing } : null;
  const calls = { graph: [], conversationUpdates: [], accountUpdates: [], creates: [], reclaims: [], rowUpdates: [] };

  const deps = {
    now: () => NOW,
    config: () => ({ partnerAgent: "", testEventCode: "", ...opts.config }),
    Conversation: {
      findById: (id) => query(conversation && String(conversation._id) === String(id) ? conversation : null),
      updateOne: async (filter, update) => {
        calls.conversationUpdates.push({ filter, update });
        return { matchedCount: opts.firstTouchFree ? 1 : 0 };
      },
    },
    Business: {
      findOne: (filter) =>
        query(String(filter._id) === ids.business && String(filter.userId) === ids.user ? { _id: ids.business } : null),
    },
    Account: {
      findOne: async (filter) =>
        account &&
        String(filter.userId) === String(account.userId) &&
        filter.phoneNumberId === account.phoneNumberId &&
        filter.status === account.status
          ? account
          : null,
      updateOne: async (filter, update) => {
        calls.accountUpdates.push({ filter, update });
        return { matchedCount: 1 };
      },
    },
    ConversionEvent: {
      create: async (doc) => {
        calls.creates.push(doc);
        if (row) throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
        row = { _id: ids.event, ...doc };
        return { toObject: () => ({ ...row }) };
      },
      findOneAndUpdate: async (filter, update) => {
        calls.reclaims.push({ filter, update });
        const lockExpired = row?.status === "SENDING" && row.lockedAt < filter.$or[1].lockedAt.$lt;
        if (!row || !(row.status === "FAILED" || lockExpired)) return null;
        row = { ...row, ...update.$set, attempts: (row.attempts || 1) + update.$inc.attempts };
        return { ...row };
      },
      findOne: () => query(row ? { ...row } : null),
      find: () => query(row ? [{ ...row }] : []),
      updateOne: async (filter, update) => {
        calls.rowUpdates.push({ filter, update });
        row = { ...row, ...update.$set };
        return { matchedCount: 1 };
      },
    },
    graph: {
      get: async (path, token) => {
        calls.graph.push({ method: "GET", path, token });
        if (opts.datasetGet instanceof Error) throw opts.datasetGet;
        return opts.datasetGet ?? { data: [] };
      },
      post: async (path, body, token) => {
        calls.graph.push({ method: "POST", path, body, token });
        const answer = path.endsWith("/dataset")
          ? opts.datasetPost ?? { id: "888000222" }
          : opts.eventsAnswer ?? { events_received: 1, messages: [], fbtrace_id: "trace-1" };
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
  return { deps, calls, opts, row: () => row };
}

const mark = (w, args = {}) =>
  markConversation({ userId: ids.user, conversationId: ids.conversation, event: "lead", ...args }, w.deps);
const eventCalls = (w) => w.calls.graph.filter((c) => c.path.endsWith("/events"));

test("a Click-to-WhatsApp ad message gives the click id and ad id; other messages give none", () => {
  assert.deepEqual(extractCtwaReferral(adMessage), {
    clid: CLID,
    adId: "120000000000001",
    sourceType: "ad",
    sourceUrl: "https://fb.me/example",
    headline: "Diwali offer",
    mediaType: "image",
  });
  assert.equal(extractCtwaReferral({ type: "text", text: { body: "hi" } }), null);
  // Ads shown in WhatsApp Status send a referral without ctwa_clid.
  assert.equal(extractCtwaReferral({ referral: { source_type: "ad", source_id: "120000000000001" } }), null);
  assert.equal(extractCtwaReferral({ referral: { ctwa_clid: "   " } }), null);
});

test("the first ad click is saved on the conversation and a later one never replaces it", async () => {
  const first = world();
  const result = await captureReferral({ conversationId: ids.conversation, message: adMessage }, first.deps);
  assert.deepEqual(result, { captured: true, adId: "120000000000001" });
  const { filter, update } = first.calls.conversationUpdates[0];
  assert.deepEqual(filter, { _id: ids.conversation, "ctwa.clid": null });
  assert.equal(update.$set.ctwa.clid, CLID);
  assert.equal(update.$set.ctwa.adId, "120000000000001");
  assert.equal(update.$set.ctwa.capturedAt.toISOString(), new Date(1763290000 * 1000).toISOString());

  const later = world({ firstTouchFree: false });
  const secondClick = { ...adMessage, referral: { ...adMessage.referral, ctwa_clid: "SECOND-CLICK" } };
  assert.equal((await captureReferral({ conversationId: ids.conversation, message: secondClick }, later.deps)).skipped, "first_touch_kept");

  const organic = world();
  const plain = await captureReferral({ conversationId: ids.conversation, message: { type: "text", text: { body: "hi" } } }, organic.deps);
  assert.equal(plain.skipped, "no_click_id");
  assert.equal(organic.calls.conversationUpdates.length, 0);

  const noTime = world();
  await captureReferral({ conversationId: ids.conversation, message: { ...adMessage, timestamp: "garbage" } }, noTime.deps);
  assert.equal(noTime.calls.conversationUpdates[0].update.$set.ctwa.capturedAt.getTime(), NOW.getTime());
});

test("marking a lead reports LeadSubmitted with the click id to the WABA's dataset and records it", async () => {
  const w = world();
  const res = await mark(w);
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.event, "lead");
  assert.equal(res.body.data.status, "SENT");

  assert.equal(w.calls.graph.length, 1, "the saved dataset is reused without a lookup");
  const [send] = eventCalls(w);
  assert.equal(send.path, "/777000111/events");
  assert.equal(send.token, "business-token");
  assert.deepEqual(send.body, {
    data: [
      {
        event_name: "LeadSubmitted",
        event_time: Math.floor(NOW.getTime() / 1000),
        event_id: `wa-${ids.conversation}-LeadSubmitted`,
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: { whatsapp_business_account_id: WABA, ctwa_clid: CLID },
        custom_data: { currency: "INR", value: 0 },
      },
    ],
  });

  const created = w.calls.creates[0];
  assert.equal(created.userId, ids.user);
  assert.equal(created.businessId, ids.business);
  assert.equal(created.adId, "120000000000001");
  assert.equal(created.status, "SENDING");
  const saved = w.row();
  assert.equal(saved.status, "SENT");
  assert.equal(saved.datasetId, "777000111");
  assert.equal(saved.eventsReceived, 1);
  assert.equal(saved.fbtraceId, "trace-1");
  assert.equal(saved.sentAt.getTime(), NOW.getTime());
});

test("a sale needs a rupee amount above zero; a lead may carry one", async () => {
  for (const value of [undefined, null, "", 0, -10, "abc", "12,000", true, 2e9]) {
    const w = world();
    const res = await mark(w, { event: "purchase", value });
    assert.equal(res.status, 400, `value ${String(value)}`);
    assert.equal(res.body.code, "INVALID_VALUE");
    assert.equal(w.calls.creates.length + w.calls.graph.length, 0);
  }
  const unknown = world();
  assert.equal((await mark(unknown, { event: "refund" })).body.code, "INVALID_EVENT");

  const sale = world();
  const res = await mark(sale, { event: "Purchase", value: "1499.499" });
  assert.equal(res.status, 201);
  const [send] = eventCalls(sale);
  assert.equal(send.body.data[0].event_name, "Purchase");
  assert.equal(send.body.data[0].event_id, `wa-${ids.conversation}-Purchase`);
  assert.deepEqual(send.body.data[0].custom_data, { currency: "INR", value: 1499.5 });
  assert.equal(res.body.data.value, 1499.5);

  const lead = world();
  await mark(lead, { event: "lead", value: 250 });
  assert.deepEqual(eventCalls(lead)[0].body.data[0].custom_data, { currency: "INR", value: 250 });
});

test("a conversation is reported at most once per event", async () => {
  const sentRow = {
    _id: ids.event,
    conversationId: ids.conversation,
    eventName: "Purchase",
    eventId: `wa-${ids.conversation}-Purchase`,
    status: "SENT",
    value: 999,
    currency: "INR",
    attempts: 1,
    eventTime: NOW,
    lockedAt: NOW,
    sentAt: NOW,
  };
  const done = world({ existing: sentRow });
  const again = await mark(done, { event: "purchase", value: 999 });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadySent, true);
  assert.equal(again.body.data.status, "SENT");
  assert.equal(done.calls.graph.length, 0);
  // Only a failed send, or one stuck past the lock window, may be taken over.
  const { filter, update } = done.calls.reclaims[0];
  assert.deepEqual(filter.$or[0], { status: "FAILED" });
  assert.equal(filter.$or[1].status, "SENDING");
  assert.equal(filter.$or[1].lockedAt.$lt.getTime(), NOW.getTime() - LOCK_MS);
  assert.deepEqual(update.$inc, { attempts: 1 });

  const busy = world({ existing: { ...sentRow, status: "SENDING", sentAt: null, lockedAt: new Date(NOW.getTime() - 60 * 1000) } });
  const res = await mark(busy, { event: "purchase", value: 999 });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "IN_PROGRESS");
  assert.equal(busy.calls.graph.length, 0);

  const stuck = world({ existing: { ...sentRow, status: "SENDING", sentAt: null, lockedAt: new Date(NOW.getTime() - LOCK_MS - 1000) } });
  assert.equal((await mark(stuck, { event: "purchase", value: 999 })).status, 201);
  assert.equal(eventCalls(stuck)[0].body.data[0].event_id, `wa-${ids.conversation}-Purchase`);
  assert.equal(stuck.row().attempts, 2);
});

test("a failed send is recorded and can be retried with the same event id", async () => {
  const w = world({ eventsAnswer: metaError(100, "Invalid parameter") });
  const first = await mark(w);
  assert.equal(first.status, 502);
  assert.equal(first.body.code, "META_ERROR");
  assert.equal(first.body.data.status, "FAILED");
  assert.equal(w.row().status, "FAILED");
  assert.equal(w.row().errorCode, "META_ERROR");
  assert.equal(w.row().errorMessage, "Invalid parameter (Meta error 100)");

  w.opts.eventsAnswer = { events_received: 1, fbtrace_id: "trace-2" };
  const second = await mark(w);
  assert.equal(second.status, 201);
  assert.equal(w.row().status, "SENT");
  assert.equal(w.row().attempts, 2);
  assert.equal(w.row().errorCode, null);
  assert.deepEqual(
    eventCalls(w).map((c) => c.body.data[0].event_id),
    [`wa-${ids.conversation}-LeadSubmitted`, `wa-${ids.conversation}-LeadSubmitted`]
  );
});

test("an answer with events_received 0 counts as a failure", async () => {
  const w = world({ eventsAnswer: { events_received: 0, messages: ["Invalid ctwa_clid"], fbtrace_id: "t" } });
  const res = await mark(w);
  assert.equal(res.status, 502);
  assert.equal(w.row().status, "FAILED");
  assert.match(w.row().errorMessage, /Invalid ctwa_clid/);
});

test("a missing permission or an expired token asks the owner to reconnect, never with a 401", async () => {
  const noPermission = world({ eventsAnswer: metaError(200, "Requires whatsapp_business_manage_events permission", 403) });
  const res = await mark(noPermission);
  assert.equal(res.status, 502);
  assert.equal(res.body.code, "EVENTS_PERMISSION_MISSING");
  assert.match(res.body.message, /whatsapp_business_manage_events/);

  const expired = world({ eventsAnswer: metaError(190, "Error validating access token", 401) });
  const res2 = await mark(expired);
  assert.equal(res2.status, 502);
  assert.equal(res2.body.code, "WHATSAPP_TOKEN_INVALID");

  // The dataset lookup fails the same way without the permission; then nothing is sent.
  const denied = metaError(10, "Application does not have permission for this action", 403);
  const noDataset = world({ account: baseAccount({ capiDataset: undefined }), datasetGet: denied, datasetPost: denied });
  const res3 = await mark(noDataset);
  assert.equal(res3.status, 502);
  assert.equal(res3.body.code, "EVENTS_PERMISSION_MISSING");
  assert.equal(eventCalls(noDataset).length, 0);
  assert.equal(noDataset.row().status, "FAILED");

  const timeout = describeGraphError(new Error("timeout of 15000ms exceeded"));
  assert.equal(timeout.code, "META_ERROR");
  assert.match(timeout.message, /^Could not report this to Meta/);
});

test("only the owner can mark a chat, and only a chat that came from a Click-to-WhatsApp ad", async () => {
  const w = world();
  assert.equal((await mark(w, { userId: ids.otherUser })).status, 403);
  assert.equal((await mark(w, { conversationId: "not-an-id" })).status, 404);
  assert.equal((await mark(w, { conversationId: "64b0000000000000000000ff" })).status, 404);

  const organic = world({ conversation: baseConversation({ ctwa: undefined }) });
  const res = await mark(organic);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "NOT_FROM_AD");
  for (const x of [w, organic]) assert.equal(x.calls.creates.length + x.calls.graph.length, 0);
});

test("the chat's WhatsApp number must still be connected on the same WABA", async () => {
  const offline = world({ account: null });
  const r1 = await mark(offline);
  assert.equal(r1.status, 404);
  assert.equal(r1.body.code, "WHATSAPP_NOT_CONNECTED");

  const moved = world({ account: baseAccount({ wabaId: "5550009999" }) });
  const r2 = await mark(moved);
  assert.equal(r2.status, 409);
  assert.equal(r2.body.code, "WABA_MISMATCH");
  for (const x of [offline, moved]) assert.equal(x.calls.creates.length + x.calls.graph.length, 0);
});

test("the dataset is looked up once per WABA and saved on the account", async () => {
  const fresh = baseAccount({ capiDataset: undefined });

  const viaGet = world({ datasetGet: { data: [{ id: "999000333", name: "MarketingKart" }] } });
  assert.equal(await getOrCreateDataset(fresh, viaGet.deps), "999000333");
  assert.deepEqual(viaGet.calls.graph.map((c) => `${c.method} ${c.path}`), [`GET /${WABA}/dataset`]);
  assert.deepEqual(viaGet.calls.accountUpdates[0].filter, { _id: ids.account });
  assert.deepEqual(viaGet.calls.accountUpdates[0].update.$set.capiDataset, { datasetId: "999000333", wabaId: WABA, savedAt: NOW });

  // Reading the edge is listed as unsupported; POST answers with the WABA's existing (or a new) dataset.
  const viaPost = world({ datasetGet: metaError(100, "Unsupported get request") });
  assert.equal(await getOrCreateDataset(fresh, viaPost.deps), "888000222");
  assert.deepEqual(viaPost.calls.graph.map((c) => `${c.method} ${c.path}`), [`GET /${WABA}/dataset`, `POST /${WABA}/dataset`]);

  // A dataset saved for the WABA that was connected before a reconnect is not reused.
  const reconnected = world({ datasetGet: { id: "999000444" } });
  const oldDataset = baseAccount({ capiDataset: { datasetId: "777000111", wabaId: "4444" } });
  assert.equal(await getOrCreateDataset(oldDataset, reconnected.deps), "999000444");

  const nothing = world({ datasetGet: {}, datasetPost: {} });
  await assert.rejects(getOrCreateDataset(fresh, nothing.deps), /did not return a dataset/);
  assert.equal(nothing.calls.accountUpdates.length, 0);
});

test("partner_agent and test_event_code are sent only when configured", async () => {
  const plain = world();
  await mark(plain);
  assert.deepEqual(Object.keys(eventCalls(plain)[0].body), ["data"]);

  const configured = world({ config: { partnerAgent: "marketingkart", testEventCode: "TEST12345" } });
  await mark(configured);
  const { body } = eventCalls(configured)[0];
  assert.equal(body.partner_agent, "marketingkart");
  assert.equal(body.test_event_code, "TEST12345");
});

test("the status shows the ad and each event without exposing the click id", async () => {
  const leadSent = { _id: ids.event, conversationId: ids.conversation, eventName: "LeadSubmitted", status: "SENT", value: 0, currency: "INR", attempts: 1, sentAt: NOW };
  const w = world({ existing: leadSent });
  const res = await getConversionState({ userId: ids.user, conversationId: ids.conversation }, w.deps);
  assert.equal(res.status, 200);
  const { data } = res.body;
  assert.equal(data.fromAd, true);
  assert.equal(data.ad.adId, "120000000000001");
  assert.equal(data.ad.headline, "Diwali offer");
  assert.equal(data.events.lead.status, "SENT");
  assert.equal(data.events.purchase, null);
  assert.deepEqual(data.canMark, { lead: false, purchase: true });
  assert.ok(!JSON.stringify(res.body).includes(CLID));

  const failed = world({ existing: { ...leadSent, status: "FAILED", errorCode: "META_ERROR", errorMessage: "Invalid parameter" } });
  const retry = (await getConversionState({ userId: ids.user, conversationId: ids.conversation }, failed.deps)).body.data;
  assert.equal(retry.events.lead.errorCode, "META_ERROR");
  assert.equal(retry.canMark.lead, true);

  assert.equal((await getConversionState({ userId: ids.otherUser, conversationId: ids.conversation }, w.deps)).status, 403);
  const organic = world({ conversation: baseConversation({ ctwa: undefined }) });
  const plainChat = (await getConversionState({ userId: ids.user, conversationId: ids.conversation }, organic.deps)).body.data;
  assert.equal(plainChat.fromAd, false);
  assert.equal(plainChat.ad, null);
  assert.deepEqual(plainChat.canMark, { lead: false, purchase: false });
});

test("the controller scopes the call to the signed-in user and answers with the service's status", async () => {
  const controller = require("../src/controllers/whatsappConversionController");
  const original = conversions.markConversation;
  const fakeRes = () => {
    const r = { statusCode: null, body: null };
    r.status = (code) => ((r.statusCode = code), r);
    r.json = (body) => ((r.body = body), r);
    return r;
  };
  const seen = [];
  try {
    conversions.markConversation = async (args) => {
      seen.push(args);
      return { status: 201, body: { success: true } };
    };
    const ok = fakeRes();
    const body = { event: "purchase", value: 10, userId: ids.otherUser };
    await controller.markConversion({ user: { _id: ids.user }, params: { conversationId: ids.conversation }, body }, ok);
    assert.deepEqual(seen[0], { userId: ids.user, conversationId: ids.conversation, event: "purchase", value: 10 });
    assert.equal(ok.statusCode, 201);

    conversions.markConversation = async () => {
      throw new Error("database unavailable");
    };
    const broken = fakeRes();
    await controller.markConversion({ user: { _id: ids.user }, params: {}, body: {} }, broken);
    assert.equal(broken.statusCode, 500);
    assert.equal(broken.body.success, false);
  } finally {
    conversions.markConversation = original;
  }
});
