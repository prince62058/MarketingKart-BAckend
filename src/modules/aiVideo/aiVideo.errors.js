const heygen = require("./heygen.client");
const logger = require("../../utils/logger");

const UNAVAILABLE = "AI video is unavailable right now. Please try again in a few minutes.";

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// The app shows the exact gap and a Recharge button. Example: 100 on hand, 130 needed → extra 30.
function insufficientCredits(have, need) {
  const gap = require("./aiVideo.logic").creditShortfall(have, need);
  const error = httpError(400, `You need extra ${gap.short} credits to generate Video.`);
  error.code = "INSUFFICIENT_CREDITS";
  error.have = gap.have;
  error.need = gap.need;
  error.short = gap.short;
  return error;
}

// Maps a provider failure to something safe to show a customer. Billing or auth problems
// on our HeyGen account are our concern, not theirs, so they are logged and hidden.
function providerError(error) {
  if (!(error instanceof heygen.HeyGenError)) {
    if (error && error.status) return error;
    logger.error(`[AI VIDEO] ${(error && error.stack) || error}`);
    return httpError(500, UNAVAILABLE);
  }
  logger.error(`[AI VIDEO] HeyGen ${error.status} ${error.code} request=${error.requestId || "-"}: ${error.message}`);
  if (error.status === 400 || error.status === 422) return httpError(400, error.message);
  return httpError(503, UNAVAILABLE);
}

function requireProvider() {
  if (!heygen.isConfigured()) {
    logger.error("[AI VIDEO] HEYGEN_API_KEY is not set");
    throw httpError(503, UNAVAILABLE);
  }
}

module.exports = { UNAVAILABLE, httpError, insufficientCredits, providerError, requireProvider };
