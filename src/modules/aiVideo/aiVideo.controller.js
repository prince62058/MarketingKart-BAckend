const responseBuilder = require("../../utils/responseBuilder");
const { apiResponseStatusCode } = require("../../Message/defaultMessage");
const service = require("./aiVideo.service");
const settings = require("./aiVideo.settings");

// The business this request works in. `handler` fills req.business once it has checked that the
// business really belongs to the signed-in customer; nothing reads the raw header any more.
function businessId(req) {
  return req.business ?? null;
}

function send(res, message, data, status = 200) {
  return res.status(status).json(responseBuilder(apiResponseStatusCode[status] || status, message, data));
}

// responseBuilder only flags a handful of statuses as failures; errors here also use 503.
function fail(res, error) {
  const status = error.status || 500;
  const body = responseBuilder(apiResponseStatusCode[status] || status, error.message);
  return res.status(status).json({ ...body, success: false });
}

// `scoped: false` is for calls that never touch a studio (voice lists, scripts, payment
// confirmation), so a stale business id in the header cannot get in their way.
function handler(run, { message, status, scoped = true }) {
  return async (req, res) => {
    try {
      if (scoped) req.business = await service.resolveBusiness(req.user, req.headers["x-business-id"]);
      const data = await run(req);
      return send(res, typeof message === "function" ? message(data) : message, data, status);
    } catch (error) {
      return fail(res, error);
    }
  };
}

const user = req => req.user._id;

const studio = handler(
  async req => {
    const [doc, config] = await Promise.all([service.getStudio(user(req), businessId(req)), settings.get()]);
    return service.present(doc, config);
  },
  { message: "Studio" },
);
const goal = handler(req => service.saveGoal(user(req), businessId(req), req.body?.goal), { message: "Goal saved" });
const script = handler(req => service.writeScript(user(req), req.body || {}), { message: "Script ready", scoped: false });
// req.file is the customer's own voice note when the app sent one (multipart), otherwise undefined.
const createProject = handler(req => service.createProject(user(req), businessId(req), req.body || {}, req.file || null), {
  message: "Video queued",
  status: 201,
});
const project = handler(req => service.getProject(user(req), businessId(req), req.params.id), { message: "Video" });
const deleteProject = handler(req => service.deleteProject(user(req), businessId(req), req.params.id), {
  message: "Video deleted",
});
const voiceover = handler(req => service.createVoiceover(user(req), businessId(req), req.body || {}), {
  message: "Voiceover ready",
  status: 201,
});
const createAvatar = handler(req => service.saveAvatar(user(req), businessId(req), req.body || {}, req.file), {
  message: "Avatar queued",
  status: 201,
});
const voicePreview = handler(req => service.voicePreview({ voice: req.query.voice, language: req.query.language }), {
  message: "Voice sample",
  scoped: false,
});
const listVoices = handler(req => service.listVoices({ language: req.query.language, gender: req.query.gender, search: req.query.search }), {
  message: "Voices",
  scoped: false,
});
const initVideoAvatar = handler(req => service.initVideoAvatar(user(req), businessId(req), req.body || {}), {
  message: "Upload ready",
  status: 201,
});
const completeVideoAvatar = handler(req => service.completeVideoAvatar(user(req), businessId(req), req.params.id), {
  message: "Avatar queued",
  status: 201,
});
const avatarConsent = handler(req => service.requestAvatarConsent(user(req), businessId(req), req.params.id), {
  message: "Consent link",
});
const deleteAvatar = handler(req => service.removeAvatar(user(req), businessId(req), req.params.id), { message: "Avatar removed" });
const avatar = handler(req => service.getAvatar(user(req), businessId(req), req.params.id), { message: "Avatar" });
const patchAvatar = handler(req => service.updateAvatar(user(req), businessId(req), req.params.id, req.body || {}), {
  message: "Avatar updated",
});
const order = handler(req => service.createOrder(user(req), businessId(req), req.body || {}), {
  message: data => data.message,
  status: 201,
});
const confirmOrder = handler(req => service.confirmPayment(user(req), req.body || {}), {
  message: data => (data.granted ? "Payment confirmed" : "Payment pending"),
  scoped: false,
});
const walletOrder = handler(req => service.payWithWallet(user(req), req.params.id), { message: "Paid from wallet", scoped: false });
const enterprise = handler(req => service.requestEnterprise(user(req), businessId(req), req.body || {}), {
  message: "Enterprise request saved",
  status: 201,
});

// Razorpay calls this, not the app: it is authenticated by the webhook signature, not a login.
// A 2xx tells Razorpay to stop retrying, so it is only sent once the event was dealt with.
async function razorpayWebhook(req, res) {
  try {
    const result = await service.handleRazorpayWebhook({
      rawBody: req.rawBody,
      signature: req.headers["x-razorpay-signature"],
    });
    return res.status(200).json({ success: true, handled: result.handled });
  } catch (error) {
    return fail(res, error);
  }
}

const providerStatus = handler(() => service.providerStatus(), { message: "AI video provider status", scoped: false });

module.exports = {
  fail,
  studio,
  goal,
  script,
  createProject,
  project,
  deleteProject,
  voiceover,
  voicePreview,
  listVoices,
  createAvatar,
  initVideoAvatar,
  completeVideoAvatar,
  avatarConsent,
  deleteAvatar,
  avatar,
  patchAvatar,
  order,
  confirmOrder,
  walletOrder,
  razorpayWebhook,
  enterprise,
  providerStatus,
};
