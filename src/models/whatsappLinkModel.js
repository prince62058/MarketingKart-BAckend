const mongoose = require("mongoose");

// A saved wa.me link / QR code. A customer whose message matches `text` came from this link:
// they join `groupId` and their chat gets `labelIds`.
const whatsappLinkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    text: { type: String, default: "", trim: true, maxlength: 1000 },
    // Lower-cased, single-spaced copy of `text`, for matching inbound messages.
    match: { type: String, default: "" },
    link: { type: String, required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappContactGroup", default: null },
    labelIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "whatsappLabel" }],
    joins: { type: Number, default: 0 },
    lastJoinAt: { type: Date, default: null },
  },
  { timestamps: true }
);

whatsappLinkSchema.index({ userId: 1, match: 1 });

module.exports = mongoose.model("whatsappLink", whatsappLinkSchema);
