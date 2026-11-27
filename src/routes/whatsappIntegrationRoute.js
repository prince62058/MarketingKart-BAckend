// Integrations: settings (signed in), store webhooks (signed by the store), Google Sheets sync (project API key).
const express = require("express");
const { authUser } = require("../middlewares/authMidd");
const apiKeyAuth = require("../middlewares/apiKeyAuth");
const svc = require("../services/whatsappIntegrationService");
const crm = require("../services/whatsappCrmService");

const handle = (fn, status = 200) => async (req, res) => {
  try {
    res.status(status).json({ success: true, data: await fn(req) });
  } catch (error) {
    if (error instanceof svc.IntegrationError) return res.status(error.status).json({ success: false, message: error.message });
    console.error("[integrations]", error.message);
    res.status(500).json({ success: false, message: "Something went wrong. Try again." });
  }
};

/* Settings — /api/whatsapp/integrations… */
const settings = express.Router();
settings.get("/whatsapp/integrations", authUser, handle((req) => svc.listIntegrations(req.user._id)));
settings.get("/whatsapp/integrations/google-sheets/sheets", authUser, handle((req) => svc.listSheets(req.user._id)));
settings.post("/whatsapp/integrations/google-sheets/sheets", authUser, handle((req) => svc.createSheet(req.user._id, req.body), 201));
settings.put("/whatsapp/integrations/google-sheets/sheets/:sheetId", authUser, handle((req) => svc.updateSheet(req.user._id, req.params.sheetId, req.body)));
settings.delete("/whatsapp/integrations/google-sheets/sheets/:sheetId", authUser, handle((req) => svc.deleteSheet(req.user._id, req.params.sheetId)));
settings.post("/whatsapp/integrations/google-sheets/sheets/:sheetId/sync", authUser, handle((req) => svc.syncSheet(req.user._id, req.params.sheetId)));
settings.post("/whatsapp/integrations/leadsquared/connect", authUser, handle(async (req) => {
  await svc.connectLeadSquared(req.user._id, req.body);
  return crm.afterLeadSquaredConnect(req.user._id);
}));

/* CRMs (HubSpot, Zoho CRM, LeadSquared): sign-in, field mapping, sync. */
settings.post("/whatsapp/integrations/:app/oauth/start", authUser, handle((req) => crm.oauthStart(req.user._id, req.params.app, req.body?.origin || req.get("origin"))));
// The CRM redirects the browser here after the user approves access (no login header on this hop).
settings.get("/whatsapp/integrations/:app/oauth/callback", async (req, res) => {
  try {
    const r = await crm.oauthCallback(req.params.app, req.query);
    if (r.redirect) return res.redirect(302, r.redirect);
    res.status(200).type("html").send(r.html);
  } catch (error) {
    console.error("[integrations] oauth callback failed:", error.message);
    res.status(500).type("html").send("<p>Sign-in failed. Close this tab and try again from Integrations.</p>");
  }
});
const crmOnly = (req, res, next) => (crm.isCrm(req.params.app) ? next() : res.status(404).json({ success: false, message: "Unknown app." }));
settings.get("/whatsapp/integrations/:app/crm", authUser, crmOnly, handle((req) => crm.getCrm(req.user._id, req.params.app)));
settings.put("/whatsapp/integrations/:app/crm", authUser, crmOnly, handle((req) => crm.updateCrm(req.user._id, req.params.app, req.body)));
settings.get("/whatsapp/integrations/:app/fields", authUser, crmOnly, handle((req) => crm.crmFields(req.user._id, req.params.app)));
settings.post("/whatsapp/integrations/:app/sync", authUser, crmOnly, handle((req) => crm.syncNow(req.user._id, req.params.app)));

settings.post("/whatsapp/integrations/:app/connect", authUser, handle((req) => svc.connectStore(req.user._id, req.params.app, req.body)));
settings.delete("/whatsapp/integrations/:app", authUser, handle((req) => (crm.isCrm(req.params.app) ? crm.disconnectCrm(req.user._id, req.params.app) : svc.disconnect(req.user._id, req.params.app))));
settings.post("/whatsapp/integrations/:app/mappings", authUser, handle((req) => svc.addMapping(req.user._id, req.params.app, req.body), 201));
settings.put("/whatsapp/integrations/:app/mappings/:mappingId", authUser, handle((req) => svc.updateMapping(req.user._id, req.params.app, req.params.mappingId, req.body)));
settings.delete("/whatsapp/integrations/:app/mappings/:mappingId", authUser, handle((req) => svc.removeMapping(req.user._id, req.params.app, req.params.mappingId)));

/* Store webhooks — /api/webhooks/ecommerce/:app/:token (no login; the store signs each call). */
settings.post("/webhooks/ecommerce/:app/:token", async (req, res) => {
  try {
    const checked = await svc.verifyWebhook(req.params.app, req.params.token, req);
    res.status(checked.status).json({ success: checked.status === 200 });
    if (checked.status === 200 && checked.events?.length) {
      svc.processEvent(checked.integration, checked.events, checked.payload)
        .catch((error) => console.error("[integrations] webhook processing failed:", error.message));
    }
  } catch (error) {
    console.error("[integrations] webhook failed:", error.message);
    if (!res.headersSent) res.status(500).json({ success: false });
  }
});

/* Google Sheets Apps Script — /api/v1/google-sheets/… with the project API key. */
const sheets = express.Router();
sheets.use(apiKeyAuth);
sheets.post("/headers", handle((req) => svc.receiveHeaders(req.user._id, req.body)));
sheets.post("/rows", handle((req) => svc.receiveRows(req.user._id, req.body)));

module.exports = { settings, sheets };
