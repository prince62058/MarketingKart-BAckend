// Conversions API for Business Messaging, end to end against the real app and a throwaway mongod:
// a signed WhatsApp webhook from a Click-to-WhatsApp ad stores the click id on the conversation (first
// touch, hidden from normal reads), and the owner's "mark as sale" call reports one Purchase to the
// WABA's dataset. axios is replaced for this whole file, so nothing reaches Meta, and the test fails
// if anything else tries to make a network call through it.
//
// Skipped when `mongod` is not installed.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { hasMongod, bootSecurityHarness } = require("./helpers/securityHarness");
const fixtures = require("./helpers/securityFixtures");

const skip = !hasMongod;
const SECRET = "webhook-test-secret";
const WABA = "1029384756";
const PHONE_NUMBER_ID = "5550001";
const DATASET = "888000222";
const CLID = "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv";

const axios = require(path.join(__dirname, "..", "node_modules", "axios"));
const realGet = axios.get;
const realPost = axios.post;
const realAppend = fs.appendFileSync;
const graphCalls = [];
const unexpected = [];

let h;
let owner;
let ownerToken;
let strangerToken;

const graphError = (status, code, message) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error: { code, message, type: "OAuthException" } } },
  });

before(async () => {
  if (skip) return;
  axios.get = async (url, config) => {
    if (url.endsWith(`/${WABA}/dataset`)) {
      graphCalls.push({ method: "GET", url, auth: config?.headers?.Authorization });
      throw graphError(400, 100, "Unsupported get request");
    }
    unexpected.push(`GET ${url}`);
    throw new Error(`unexpected network call: GET ${url}`);
  };
  axios.post = async (url, body, config) => {
    const auth = config?.headers?.Authorization;
    if (url.endsWith(`/${WABA}/dataset`)) {
      graphCalls.push({ method: "POST", url, body, auth });
      return { data: { id: DATASET } };
    }
    if (url.endsWith(`/${DATASET}/events`)) {
      graphCalls.push({ method: "POST", url, body, auth });
      return { data: { events_received: 1, messages: [], fbtrace_id: "trace-e2e" } };
    }
    unexpected.push(`POST ${url}`);
    throw new Error(`unexpected network call: POST ${url}`);
  };
  // The webhook appends every payload to webhook_payloads.log in the repo; keep test payloads out of it.
  fs.appendFileSync = (file, ...rest) =>
    String(file).endsWith("webhook_payloads.log") ? undefined : realAppend.call(fs, file, ...rest);

  h = await bootSecurityHarness({ env: { clientSecret: SECRET, WHATSAPP_TOKEN_ENCRYPTION_KEY: "cd".repeat(32) } });
  await require("../src/models/whatsappConversionEventModel").init();
  owner = await fixtures.makeUser();
  ownerToken = fixtures.tokenFor(owner);
  strangerToken = fixtures.tokenFor(await fixtures.makeUser());
  await fixtures.makeBusiness(owner);
  await require("../src/models/whatsappAccountModel").create({
    userId: owner._id,
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: WABA,
    phoneNumber: "+91 70000 00001",
    accessToken: "owner-business-token",
    status: "CONNECTED",
  });
});

after(async () => {
  axios.get = realGet;
  axios.post = realPost;
  fs.appendFileSync = realAppend;
  if (h) await h.close();
});

// An image message keeps the AI auto-reply (text messages only) out of this test.
const inbound = (wamid, clid, timestamp) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: WABA,
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "917000000001", phone_number_id: PHONE_NUMBER_ID },
            contacts: [{ profile: { name: "Asha" }, wa_id: "919876543210" }],
            messages: [
              {
                from: "919876543210",
                id: wamid,
                timestamp,
                type: "image",
                image: { id: `media-${wamid}`, mime_type: "image/jpeg" },
                referral: {
                  source_url: "https://fb.me/example",
                  source_id: "120000000000001",
                  source_type: "ad",
                  headline: "Diwali offer",
                  media_type: "image",
                  ctwa_clid: clid,
                },
              },
            ],
          },
        },
      ],
    },
  ],
});

const postWebhook = (payload) =>
  h.call("POST", "/api/whatsapp/webhook", {
    body: payload,
    headers: { "x-hub-signature-256": `sha256=${crypto.createHmac("sha256", SECRET).update(JSON.stringify(payload)).digest("hex")}` },
  });

// The webhook answers Meta first and does its work afterwards, so wait for the result.
async function waitFor(read, done) {
  for (let i = 0; i < 100; i += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return read();
}

test("an ad chat keeps its first click id, and a sale is reported to the WABA's dataset once", { skip }, async () => {
  const Conversation = require("../src/models/whatsappConversationModel");
  const Message = require("../src/models/whatsappMessageModel");
  const Account = require("../src/models/whatsappAccountModel");
  const ConversionEvent = require("../src/models/whatsappConversionEventModel");

  assert.equal((await postWebhook(inbound("wamid.AD1", CLID, "1763290000"))).status, 200);
  const conversation = await waitFor(
    () => Conversation.findOne({ phoneNumberId: PHONE_NUMBER_ID }).select("+ctwa.clid").lean(),
    (c) => c?.ctwa?.clid
  );
  assert.equal(conversation?.ctwa?.clid, CLID);
  assert.equal(conversation.ctwa.adId, "120000000000001");
  assert.equal(conversation.ctwa.headline, "Diwali offer");
  assert.equal(conversation.ctwa.capturedAt.toISOString(), new Date(1763290000 * 1000).toISOString());

  // A later ad click in the same chat does not replace the first one.
  assert.equal((await postWebhook(inbound("wamid.AD2", "SECOND-CLICK", "1763300000"))).status, 200);
  await waitFor(() => Message.countDocuments({ phoneNumberId: PHONE_NUMBER_ID }), (n) => n >= 2);
  const kept = await Conversation.findById(conversation._id).select("+ctwa.clid").lean();
  assert.equal(kept.ctwa.clid, CLID);

  // Normal reads, such as the inbox list, never carry the click id.
  const inbox = await h.call("GET", "/api/whatsapp/chat/conversations", { token: ownerToken });
  assert.equal(inbox.status, 200);
  const listed = inbox.body.data.find((c) => String(c._id) === String(conversation._id));
  assert.equal(listed.ctwa.adId, "120000000000001");
  assert.equal(listed.ctwa.clid, undefined);
  assert.ok(!inbox.text.includes(CLID));

  const route = `/api/whatsapp/chat/conversations/${conversation._id}/conversion`;
  assert.equal((await h.call("GET", route)).status, 401);
  assert.equal((await h.call("GET", route, { token: strangerToken })).status, 403);
  assert.equal((await h.call("POST", route, { token: strangerToken, body: { event: "purchase", value: 1499 } })).status, 403);
  assert.equal(graphCalls.length, 0);

  const sale = await h.call("POST", route, { token: ownerToken, body: { event: "purchase", value: 1499 } });
  assert.equal(sale.status, 201, sale.text);
  assert.equal(sale.body.data.status, "SENT");

  // GET is unsupported in this fake (as the Dataset reference says), so the POST supplies the dataset.
  assert.deepEqual(graphCalls.map((c) => `${c.method} ${new URL(c.url).pathname.replace(/^\/v[\d.]+/, "")}`), [
    `GET /${WABA}/dataset`,
    `POST /${WABA}/dataset`,
    `POST /${DATASET}/events`,
  ]);
  const send = graphCalls[2];
  assert.equal(send.auth, "Bearer owner-business-token");
  assert.match(send.url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//);
  const [event] = send.body.data;
  assert.equal(event.event_name, "Purchase");
  assert.equal(event.action_source, "business_messaging");
  assert.equal(event.messaging_channel, "whatsapp");
  assert.deepEqual(event.user_data, { whatsapp_business_account_id: WABA, ctwa_clid: CLID });
  assert.deepEqual(event.custom_data, { currency: "INR", value: 1499 });
  assert.equal(event.event_id, `wa-${conversation._id}-Purchase`);

  // The dataset is saved on the account, and a second tap is not reported again.
  const account = await Account.findOne({ userId: owner._id }).lean();
  assert.equal(account.capiDataset.datasetId, DATASET);
  assert.equal(account.capiDataset.wabaId, WABA);
  const again = await h.call("POST", route, { token: ownerToken, body: { event: "purchase", value: 1499 } });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadySent, true);
  assert.equal(graphCalls.length, 3);
  const rows = await ConversionEvent.find({ conversationId: conversation._id }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "SENT");
  assert.equal(rows[0].fbtraceId, "trace-e2e");
  assert.equal(String(rows[0].userId), String(owner._id));

  const state = await h.call("GET", route, { token: ownerToken });
  assert.equal(state.status, 200);
  assert.equal(state.body.data.fromAd, true);
  assert.equal(state.body.data.events.purchase.status, "SENT");
  assert.deepEqual(state.body.data.canMark, { lead: true, purchase: false });
  assert.ok(!state.text.includes(CLID));

  assert.deepEqual(unexpected, []);
});
