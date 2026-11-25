const mongoose = require("mongoose");
const { STOCK, KEYS } = require("../helpers/invoiceChrome");
const { SERVICES } = require("../helpers/invoiceThemes");

const fields = { name: { type: String, required: true, trim: true, maxlength: 60 } };
for (const key of KEYS) fields[key] = { type: String, default: STOCK[key] };

const invoiceTemplateSchema = new mongoose.Schema(
  {
    ...fields,
    service: { type: String, enum: ["", ...SERVICES], default: "META_ADS" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

invoiceTemplateSchema.index({ service: 1, isDefault: 1 });

module.exports = mongoose.models.InvoiceTemplate || mongoose.model("InvoiceTemplate", invoiceTemplateSchema);
