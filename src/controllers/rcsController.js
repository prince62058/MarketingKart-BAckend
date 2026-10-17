const asyncHandler = require("../utils/asyncHandler");
const responseBuilder = require("../utils/responseBuilder");
const { apiResponseStatusCode } = require("../Message/defaultMessage");
const { providerConfig, sendImageTemplate } = require("../services/bhashRcsService");

exports.getProvider = asyncHandler(async (req, res) => {
  res.json(
    responseBuilder(apiResponseStatusCode[200], "RCS provider", providerConfig()),
  );
});

exports.sendImageTemplate = asyncHandler(async (req, res) => {
  const config = providerConfig();
  if (!config.configured) {
    return res
      .status(503)
      .json(responseBuilder(apiResponseStatusCode[500], "RCS provider is not configured"));
  }
  const recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
  if (!recipients.length || recipients.length > 100) {
    return res
      .status(400)
      .json(responseBuilder(apiResponseStatusCode[400], "Send between 1 and 100 recipients."));
  }
  const templateName = req.body.templateName;
  const imageUrl = req.body.imageUrl;
  const results = [];
  for (const recipient of recipients) {
    try {
      const sent = await sendImageTemplate({
        phone: recipient.phone,
        templateName,
        imageUrl,
      });
      results.push({
        contactId: recipient.contactId || "",
        phone: sent.phone,
        ok: sent.ok,
        providerResponse: sent.providerResponse,
      });
    } catch (error) {
      results.push({
        contactId: recipient.contactId || "",
        phone: String(recipient.phone || ""),
        ok: false,
        providerResponse: error.message,
      });
    }
  }
  const sent = results.filter(item => item.ok).length;
  res.json(
    responseBuilder(apiResponseStatusCode[200], `Sent ${sent} of ${results.length}`, {
      sent,
      failed: results.length - sent,
      results,
    }),
  );
});
