const mongoose = require("mongoose");

// What a super admin has decided for one WhatsApp customer: suspended or not, and features
// switched on or off for this account only (a missing key follows the global setting).
const whatsappControlSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, unique: true },
    suspended: { type: Boolean, default: false },
    suspendReason: { type: String, default: "", maxlength: 300 },
    features: { type: Map, of: Boolean, default: {} },
    note: { type: String, default: "", maxlength: 2000 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.whatsappControl || mongoose.model("whatsappControl", whatsappControlSchema);
