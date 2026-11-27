const mongoose = require("mongoose");

// A Google Sheet whose rows become contacts. The sheet's own Apps Script posts its header row
// and new rows with `syncToken` and the user's project API key.
const whatsappSheetSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    name: { type: String, default: "", trim: true, maxlength: 80 },
    syncToken: { type: String, required: true, unique: true },
    webAppUrl: { type: String, default: "" },
    headers: { type: [String], default: [] },
    // { phone: "Mobile", name: "Full Name", custom: { city: "City" } } — sheet column names.
    mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappContactGroup", default: null },
    rowsImported: { type: Number, default: 0 },
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model("whatsappSheet", whatsappSheetSchema);
