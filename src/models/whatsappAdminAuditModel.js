const mongoose = require("mongoose");

// Every change a super admin makes to WhatsApp customers or panel settings, newest first.
const whatsappAdminAuditSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now, index: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", default: null },
    adminName: { type: String, default: "" },
    action: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", default: null, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { versionKey: false }
);

module.exports = mongoose.models.whatsappAdminAudit || mongoose.model("whatsappAdminAudit", whatsappAdminAuditSchema);
