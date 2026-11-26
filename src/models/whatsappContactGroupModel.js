const mongoose = require("mongoose");

const whatsappContactGroupSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // A customer who sends one of these words is added to the group (used by the inbound handler).
    keywords: { type: [String], default: [] },
  },
  { timestamps: true }
);

whatsappContactGroupSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("whatsappContactGroup", whatsappContactGroupSchema);
