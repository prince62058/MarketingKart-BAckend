const mongoose = require("mongoose");

// The WhatsApp customer panel's brands (workspaces) for one account, so they follow the person to
// any browser or device instead of living only in one browser's storage.
const brandSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 40 },
    name: { type: String, required: true, maxlength: 60 },
    timezone: { type: String, default: "", maxlength: 60 },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "business", default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const panelBrandSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, unique: true },
    brands: { type: [brandSchema], default: [] },
    currentId: { type: String, default: "", maxlength: 40 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.whatsappPanelBrand || mongoose.model("whatsappPanelBrand", panelBrandSchema);
