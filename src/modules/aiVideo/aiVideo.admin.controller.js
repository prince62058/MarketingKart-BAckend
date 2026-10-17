const responseBuilder = require("../../utils/responseBuilder");
const { apiResponseStatusCode } = require("../../Message/defaultMessage");
const admin = require("./aiVideo.admin.service");

function fail(res, error) {
  const status = error.status || 500;
  const body = responseBuilder(apiResponseStatusCode[status] || status, status === 500 ? "Something went wrong. Please try again." : error.message);
  return res.status(status).json({ ...body, success: false });
}

// Admin tables expect the rows in `data` and the paging numbers beside it, like the other admin lists.
function sendPage(res, message, result) {
  const { data, total, totalPages, currentPage } = result;
  return res.status(200).json({ ...responseBuilder(apiResponseStatusCode[200], message, data), total, totalPages, currentPage });
}

const one = (run, message) => async (req, res) => {
  try {
    const data = await run(req);
    return res.status(200).json(responseBuilder(apiResponseStatusCode[200], message, data));
  } catch (error) {
    return fail(res, error);
  }
};

const list = (run, message) => async (req, res) => {
  try {
    return sendPage(res, message, await run(req));
  } catch (error) {
    return fail(res, error);
  }
};

module.exports = {
  health: one(() => admin.health(), "AI video health"),
  overview: one(() => admin.overview(), "AI video overview"),
  videos: list(req => admin.listVideos(req.query), "Videos"),
  refundVideo: one(req => admin.refundVideo({ admin: req.user, ...req.params, reason: req.body?.reason }), "Video refunded"),
  deleteVideo: one(req => admin.deleteVideo({ admin: req.user, ...req.params }), "Video deleted"),
  avatars: list(req => admin.listAvatars(req.query), "Avatars"),
  deleteAvatar: one(req => admin.deleteAvatar({ admin: req.user, ...req.params }), "Avatar removed"),
  studios: list(req => admin.listStudios(req.query), "Studios"),
  studio: one(req => admin.getStudio(req.params.studioId), "Studio"),
  adjustCredits: one(req => admin.adjustCredits({ admin: req.user, studioId: req.params.studioId, amount: req.body?.amount, reason: req.body?.reason }), "Credits updated"),
  setPlan: one(req => admin.setPlan({ admin: req.user, studioId: req.params.studioId, planId: req.body?.planId, days: req.body?.days }), "Plan updated"),
  orders: list(req => admin.listOrders(req.query), "Orders"),
  enterprise: list(req => admin.listEnterprise(req.query), "Enterprise requests"),
  updateEnterprise: one(req => admin.updateEnterprise({ admin: req.user, studioId: req.params.studioId, status: req.body?.status, note: req.body?.note }), "Request updated"),
  audit: list(req => admin.listAudit(req.query), "Audit log"),
  settings: one(() => admin.getSettings(), "Settings"),
  updateSettings: one(req => admin.updateSettings(req.body || {}, req.user), "Settings saved"),
  fail,
};
