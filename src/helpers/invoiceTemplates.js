const Template = require("../models/invoiceTemplate.model");
const { STOCK } = require("./invoiceChrome");
const { invoiceService, SERVICES } = require("./invoiceThemes");

async function ensureDefault() {
  const existing = await Template.findOne({ service: "META_ADS", isDefault: true });
  if (existing) return existing;
  return Template.create({
    name: "MarketingKart Meta",
    service: "META_ADS",
    isDefault: true,
    ...STOCK,
    // The printed page already hides this placeholder and uses the company phone when there is one.
    brandPhone: "",
  });
}

async function resolveTemplate(invoice) {
  if (invoice?.templateId) {
    const chosen = await Template.findById(invoice.templateId);
    if (chosen) return chosen;
  }
  const service = invoiceService(invoice || {});
  const specific = await Template.findOne({ service, isDefault: true });
  if (specific) return specific;
  const shared = await Template.findOne({ service: "", isDefault: true });
  if (shared) return shared;
  return ensureDefault();
}

function cleanTemplate(input, { nameRequired = true } = {}) {
  const body = input || {};
  const name = String(body.name || "").trim().slice(0, 60);
  if (nameRequired && !name) {
    const error = new Error("Give the template a name.");
    error.status = 400;
    throw error;
  }
  const service = body.service === undefined ? undefined : String(body.service || "");
  if (service !== undefined && service !== "" && !SERVICES.includes(service)) {
    const error = new Error("Choose Meta Ads, WhatsApp, AI Video, RCS, or leave the service open.");
    error.status = 400;
    throw error;
  }
  const patch = {};
  if (name) patch.name = name;
  if (service !== undefined) patch.service = service;
  if (body.isDefault !== undefined) patch.isDefault = Boolean(body.isDefault);
  const { chromeFromBody } = require("./invoiceChrome");
  return { ...patch, ...chromeFromBody(body) };
}

async function makeDefault(doc) {
  if (!doc?.isDefault) return doc;
  await Template.updateMany({ _id: { $ne: doc._id }, service: doc.service || "" }, { $set: { isDefault: false } });
  return doc;
}

module.exports = { ensureDefault, resolveTemplate, cleanTemplate, makeDefault };
