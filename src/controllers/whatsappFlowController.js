const flows = require("../services/whatsappFlowService");

// Every handler answers { success: true, ... } or the service's error as JSON.
const handle = (fn, okStatus = 200) => async (req, res) => {
  try {
    const result = await fn(req);
    return res.status(okStatus).json({ success: true, ...result });
  } catch (err) {
    const { status, body } = flows.toHttp(err);
    if (status >= 500) console.error("[WA Flows]", req.method, req.originalUrl, err?.message);
    return res.status(status).json(body);
  }
};

exports.listStarters = handle(async () => ({ data: flows.listStarters() }));

exports.listFlows = handle(async (req) => {
  const { connected, flows: list } = await flows.listFlows(req.user._id);
  return { connected, data: list };
});

exports.syncFlows = handle(async (req) => ({ data: await flows.syncFlows(req.user._id) }));

exports.getFlow = handle(async (req) => ({ data: await flows.getFlow(req.user._id, req.params.flowId) }));

exports.createFlow = handle(async (req) => {
  const { name, categories, starter, definition } = req.body || {};
  return { data: await flows.createFlow(req.user._id, { name, categories, starter, definition }) };
}, 201);

exports.updateFlow = handle(async (req) => {
  const { name, categories, definition } = req.body || {};
  return { data: await flows.updateFlow(req.user._id, req.params.flowId, { name, categories, definition }) };
});

exports.publishFlow = handle(async (req) => ({ data: await flows.publishFlow(req.user._id, req.params.flowId) }));

exports.previewFlow = handle(async (req) => ({ data: await flows.previewFlow(req.user._id, req.params.flowId) }));

exports.deprecateFlow = handle(async (req) => ({ data: await flows.deprecateFlow(req.user._id, req.params.flowId) }));

exports.deleteFlow = handle(async (req) => ({ data: await flows.deleteFlow(req.user._id, req.params.flowId) }));

exports.sendFlow = handle(async (req) => {
  const { conversationId, bodyText, ctaText, headerText } = req.body || {};
  return { data: await flows.sendFlow(req.user._id, req.params.flowId, { conversationId, bodyText, ctaText, headerText }) };
});

exports.listResponses = handle(async (req) => ({
  data: await flows.listResponses(req.user._id, req.params.flowId, { page: req.query.page }),
}));
