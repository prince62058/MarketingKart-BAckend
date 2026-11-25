const Template = require("../models/invoiceTemplate.model");
const { ensureDefault, cleanTemplate, makeDefault } = require("../helpers/invoiceTemplates");
const { KEYS } = require("../helpers/invoiceChrome");

function present(doc) {
  const row = doc.toObject ? doc.toObject() : doc;
  const chrome = {};
  for (const key of KEYS) chrome[key] = row[key] ?? "";
  return {
    id: String(row._id),
    name: row.name,
    service: row.service || "",
    isDefault: Boolean(row.isDefault),
    updatedAt: row.updatedAt,
    ...chrome,
  };
}

exports.listInvoiceTemplates = async (req, res) => {
  try {
    await ensureDefault();
    const rows = await Template.find().sort({ isDefault: -1, name: 1 });
    return res.json({ success: true, data: rows.map(present) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createInvoiceTemplate = async (req, res) => {
  try {
  const sourceId = req.body?.copyFrom;
  let seed = {};
  if (sourceId) {
    const source = await Template.findById(sourceId);
    if (!source) return res.status(404).json({ success: false, message: "Template not found" });
    seed = source.toObject();
    delete seed._id;
    delete seed.createdAt;
    delete seed.updatedAt;
  } else {
    const base = await ensureDefault();
    seed = base.toObject();
    delete seed._id;
  }
  const patch = cleanTemplate({ ...seed, ...req.body, isDefault: false, name: req.body?.name || `Copy of ${seed.name || "MarketingKart"}` });
  const created = await Template.create({ ...seed, ...patch, isDefault: false });
  return res.status(201).json({ success: true, data: present(created) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.updateInvoiceTemplate = async (req, res) => {
  try {
  const current = await Template.findById(req.params.id);
  if (!current) return res.status(404).json({ success: false, message: "Template not found" });
  const patch = cleanTemplate(req.body, { nameRequired: false });
  if (patch.isDefault === false && current.isDefault) {
    return res.status(400).json({ success: false, message: "Choose another template as the default before turning this one off." });
  }
  Object.assign(current, patch);
  await current.save();
  await makeDefault(current);
  return res.json({ success: true, data: present(current) });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.deleteInvoiceTemplate = async (req, res) => {
  try {
  const current = await Template.findById(req.params.id);
  if (!current) return res.status(404).json({ success: false, message: "Template not found" });
  if (current.isDefault) {
    return res.status(400).json({ success: false, message: "This template is live. Make another one the default first." });
  }
  await current.deleteOne();
  return res.json({ success: true });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};
