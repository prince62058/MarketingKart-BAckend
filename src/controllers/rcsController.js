const asyncHandler = require("../utils/asyncHandler");
const responseBuilder = require("../utils/responseBuilder");
const { apiResponseStatusCode } = require("../Message/defaultMessage");
const { providerConfig, sendImageTemplate } = require("../services/bhashRcsService");
const rcsSettings = require("../services/rcsSettingsService");

exports.getProvider = asyncHandler(async (req, res) => {
  const settings = await rcsSettings.get();
  const provider = providerConfig();
  res.json(
    responseBuilder(apiResponseStatusCode[200], "RCS provider", {
      ...provider,
      displayName: settings.providerDisplayName,
      messageTypeLabel: settings.providerMessageType,
      enabled: settings.enabled,
    }),
  );
});

exports.sendImageTemplate = asyncHandler(async (req, res) => {
  const settings = await rcsSettings.get();
  if (!settings.enabled) {
    return res
      .status(503)
      .json(responseBuilder(apiResponseStatusCode[500], "RCS messaging is paused by admin."));
  }
  const config = providerConfig();
  if (!config.configured) {
    return res
      .status(503)
      .json(responseBuilder(apiResponseStatusCode[500], "RCS provider is not configured"));
  }
  const recipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
  const maxBatch = settings.maxSendBatch || 100;
  if (!recipients.length || recipients.length > maxBatch) {
    return res
      .status(400)
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          `Send between 1 and ${maxBatch} recipients.`,
        ),
      );
  }
  const templateName = req.body.templateName || settings.defaultTemplateId;
  const imageUrl = req.body.imageUrl || settings.defaultDemoImageUrl;
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
