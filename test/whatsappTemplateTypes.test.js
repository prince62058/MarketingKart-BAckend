// Template types from WhatsApp Manager (Default, Catalogue, Flows, Calling permissions request,
// One-time passcode): the Meta components each one builds, through the real createTemplate handler.
// The models, the template service and the Meta upload are fakes; no network, no database.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.join(__dirname, "..");
const fake = (id, exports) => {
  const file = require.resolve(path.join(root, id));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const USER = "64b0000000000000000000a1";
const FLOW_ID = "64b0000000000000000000f1";
const state = { account: null, flows: [], saved: [], uploads: [] };

fake("src/services/whatsappTemplateService", {
  createTemplate: async (data) => {
    state.saved.push(data);
    return { _id: "tpl-1", ...data };
  },
});
fake("src/services/whatsappCloudApiService", {
  uploadTemplateToMeta: async (template, credentials) => {
    state.uploads.push({ template, credentials });
    return { id: "meta-tpl-1", status: "PENDING" };
  },
  uploadTemplateHeaderSample: async ({ sourceUrl }) => `handle:${sourceUrl}`,
});
fake("src/models/whatsappAccountModel", { findOne: async () => state.account });
fake("src/models/whatsappTemplateModel", { deleteOne: async () => ({ deletedCount: 0 }) });
fake("src/models/whatsappFlowModel", {
  findOne: async (q) => state.flows.find((f) => String(f._id) === String(q._id) && String(f.userId) === String(q.userId)) || null,
});

// The campaign service opens a BullMQ queue (Redis) when it loads; never in a test.
fake("src/queues/whatsappQueue", { add: async () => {}, addBulk: async () => {}, on: () => {} });

const { createTemplate } = require("../src/controllers/whatsappTemplateController");
const { buildComponents } = require("../src/services/whatsappCampaignService");
const types = require("../src/services/whatsappTemplateTypes");

const ACCOUNT = { userId: USER, wabaId: "waba-1", phoneNumberId: "pn-1", accessToken: "token-1", status: "CONNECTED" };
const FLOW = {
  _id: FLOW_ID,
  userId: USER,
  wabaId: "waba-1",
  metaFlowId: "1673152217594150",
  status: "PUBLISHED",
  definition: { screens: [{ title: "Form", fields: [] }] },
};

async function create(body, { account = ACCOUNT, flows = [FLOW] } = {}) {
  Object.assign(state, { account, flows, saved: [], uploads: [] });
  const res = { statusCode: 0, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  // An admin skips the plan check, which would need the subscription model.
  await createTemplate({ user: { _id: USER, userType: "ADMIN" }, body }, res);
  const sent = state.uploads[0]?.template;
  return { res, sent, saved: state.saved[0], component: (type) => sent?.components.find((c) => c.type === type) };
}

test("a Flows template carries a FLOW button that opens the user's published flow", async () => {
  const { res, sent, saved, component } = await create({
    name: "Diwali Form",
    category: "MARKETING",
    templateType: "FLOW",
    bodyText: "Hi {{1}}, tell us what you need.",
    flowId: FLOW_ID,
    flowButtonText: "Book now",
  });
  assert.equal(res.statusCode, 201);
  assert.equal(sent.name, "diwali_form");
  assert.equal(component("BODY").text, "Hi {{1}}, tell us what you need.");
  assert.deepEqual(component("BUTTONS").buttons, [
    { type: "FLOW", text: "Book now", flow_id: "1673152217594150", flow_action: "navigate", navigate_screen: "SCREEN_A" },
  ]);
  assert.equal(saved.templateType, "FLOW");
  assert.equal(saved.metaFlowId, "1673152217594150");
  assert.deepEqual(saved.buttons, [{ type: "FLOW", text: "Book now", flowId: FLOW_ID, metaFlowId: "1673152217594150" }]);
});

test("a flow made in WhatsApp Manager opens at its own first screen", async () => {
  const imported = { ...FLOW, definition: null };
  const { component } = await create(
    { name: "imported", category: "UTILITY", templateType: "FLOW", bodyText: "Fill this", flowId: FLOW_ID },
    { flows: [imported] }
  );
  assert.deepEqual(component("BUTTONS").buttons, [{ type: "FLOW", text: "Open form", flow_id: "1673152217594150" }]);
});

test("a Flows template needs the user's own published flow on the connected WABA", async () => {
  const draft = await create(
    { name: "a", category: "MARKETING", templateType: "FLOW", bodyText: "x", flowId: FLOW_ID },
    { flows: [{ ...FLOW, status: "DRAFT" }] }
  );
  assert.equal(draft.res.statusCode, 400);
  const foreign = await create(
    { name: "b", category: "MARKETING", templateType: "FLOW", bodyText: "x", flowId: FLOW_ID },
    { flows: [{ ...FLOW, userId: "64b0000000000000000000a2" }] }
  );
  assert.equal(foreign.res.statusCode, 404);
  const otherWaba = await create(
    { name: "c", category: "MARKETING", templateType: "FLOW", bodyText: "x", flowId: FLOW_ID },
    { flows: [{ ...FLOW, wabaId: "waba-2" }] }
  );
  assert.equal(otherWaba.res.statusCode, 409);
  const noFlow = await create({ name: "d", category: "MARKETING", templateType: "FLOW", bodyText: "x" });
  assert.equal(noFlow.res.statusCode, 400);
  assert.equal(draft.sent || foreign.sent || otherWaba.sent || noFlow.sent, undefined);
});

test("a one-time passcode template uses Meta's fixed body and a copy-code button", async () => {
  const { res, sent, saved } = await create({ name: "login_code", category: "AUTHENTICATION", codeExpirationMinutes: 10 });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(sent.components, [
    { type: "BODY", add_security_recommendation: true },
    { type: "FOOTER", code_expiration_minutes: 10 },
    { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
  ]);
  assert.equal(saved.templateType, "OTP");
  assert.equal(saved.headerType, "NONE");
  assert.match(saved.bodyText, /^\{\{1\}\} is your verification code\. For your security, do not share this code\./);
  assert.deepEqual(saved.otp, { addSecurityRecommendation: true, codeExpirationMinutes: 10, buttonText: "Copy code" });

  const tooLong = await create({ name: "x", category: "AUTHENTICATION", codeExpirationMinutes: 120 });
  assert.equal(tooLong.res.statusCode, 400);
  assert.equal(tooLong.sent, undefined);
});

test("a catalogue template has no header and a View catalog button", async () => {
  const { component, saved } = await create({
    name: "shop",
    category: "MARKETING",
    templateType: "CATALOG",
    headerType: "TEXT",
    headerText: "Hello",
    bodyText: "See our new range",
    buttons: [{ type: "QUICK_REPLY", text: "ignored" }],
  });
  assert.equal(component("HEADER"), undefined);
  assert.deepEqual(component("BUTTONS").buttons, [{ type: "CATALOG", text: "View catalog" }]);
  assert.deepEqual(saved.buttons, [{ type: "CATALOG", text: "View catalog" }]);
  assert.equal(saved.headerType, "NONE");
});

test("a calling permissions request adds the call_permission_request component and no buttons", async () => {
  const { sent, saved } = await create({
    name: "call_ok",
    category: "UTILITY",
    templateType: "CALL_PERMISSION",
    bodyText: "Can we call you about your order?",
    buttons: [{ type: "QUICK_REPLY", text: "Yes" }],
  });
  assert.deepEqual(sent.components.map((c) => c.type), ["BODY", "call_permission_request"]);
  assert.deepEqual(saved.buttons, []);
  assert.equal(saved.templateType, "CALL_PERMISSION");
});

test("each type is only allowed in the categories WhatsApp Manager offers it in", async () => {
  for (const [category, templateType] of [
    ["UTILITY", "CATALOG"],
    ["MARKETING", "OTP"],
    ["AUTHENTICATION", "DEFAULT"],
    ["AUTHENTICATION", "FLOW"],
    ["MARKETING", "ROCKET"],
  ]) {
    const { res, sent } = await create({ name: "x", category, templateType, bodyText: "x" });
    assert.equal(res.statusCode, 400, `${category}/${templateType}`);
    assert.equal(sent, undefined);
  }
});

test("an image header sample is a WhatsApp handle, not the photo link", async () => {
  const { res, component, saved } = await create({
    name: "offer_photo",
    category: "MARKETING",
    headerType: "IMAGE",
    headerMediaUrl: "https://cdn.example.com/offer.jpg",
    bodyText: "New arrival",
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(component("HEADER"), {
    type: "HEADER",
    format: "IMAGE",
    example: { header_handle: ["handle:https://cdn.example.com/offer.jpg"] },
  });
  assert.equal(saved.headerMediaUrl, "https://cdn.example.com/offer.jpg");
});

test("a photo template without an uploaded file is refused", async () => {
  const { res, sent } = await create({
    name: "offer_photo",
    category: "MARKETING",
    headerType: "IMAGE",
    headerMediaUrl: "file:///storage/photo.jpg",
    bodyText: "New arrival",
  });
  assert.equal(res.statusCode, 400);
  assert.equal(sent, undefined);
});

test("the default template is built as before", async () => {
  const { component, saved } = await create({
    name: "promo",
    category: "MARKETING",
    bodyText: "Hello {{1}}",
    buttons: [{ type: "URL", text: "Shop", url: "https://example.com" }],
  });
  assert.deepEqual(component("BODY"), { type: "BODY", text: "Hello {{1}}", example: { body_text: [["Customer"]] } });
  assert.deepEqual(component("BUTTONS").buttons, [{ type: "URL", text: "Shop", url: "https://example.com" }]);
  assert.equal(saved.templateType, "DEFAULT");
});

test("new template types need a connected WhatsApp number", async () => {
  const { res, saved } = await create({ name: "x", category: "AUTHENTICATION" }, { account: null });
  assert.equal(res.statusCode, 409);
  assert.equal(saved, undefined);
});

test("a campaign names the flow in the FLOW button's token so answers can be matched", () => {
  const components = [
    { type: "BODY", text: "Hi {{1}}" },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Later" }, { type: "FLOW", text: "Open", flow_id: "1673152217594150" }] },
  ];
  const flowButton = { type: "button", sub_type: "flow", index: "1", parameters: [{ type: "action", action: { flow_token: "mkf_1673152217594150" } }] };
  assert.deepEqual(buildComponents({ 1: "Asha" }, components), [{ type: "body", parameters: [{ type: "text", text: "Asha" }] }, flowButton]);
  assert.deepEqual(buildComponents({}, components), [flowButton]);
  assert.deepEqual(buildComponents({}, [{ type: "BODY", text: "Hello" }]), []);
  assert.deepEqual(
    buildComponents({}, [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hello" }], {
      headerType: "IMAGE",
      headerMediaUrl: "https://cdn.example.com/offer.jpg",
    }),
    [{ type: "header", parameters: [{ type: "image", image: { link: "https://cdn.example.com/offer.jpg" } }] }]
  );
});

test("templates synced from Meta get their type and flow id", () => {
  const flowButtons = [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "a" }, { type: "FLOW", text: "Go", flow_id: 42 }] }];
  assert.equal(types.detectTemplateType(flowButtons, "MARKETING"), "FLOW");
  assert.equal(types.flowIdOf(flowButtons), "42");
  assert.equal(types.detectTemplateType([{ type: "BODY" }, { type: "CALL_PERMISSION_REQUEST" }], "UTILITY"), "CALL_PERMISSION");
  assert.equal(types.detectTemplateType([{ type: "BUTTONS", buttons: [{ type: "CATALOG" }] }], "MARKETING"), "CATALOG");
  assert.equal(types.detectTemplateType([{ type: "BUTTONS", buttons: [{ type: "URL" }] }], "AUTHENTICATION"), "OTP");
  assert.equal(types.detectTemplateType([{ type: "BODY" }], "MARKETING"), "DEFAULT");
  assert.equal(types.flowIdOf([{ type: "BODY" }]), null);
});
