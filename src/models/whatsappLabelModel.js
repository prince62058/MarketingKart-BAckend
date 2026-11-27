const mongoose = require("mongoose");

// A chat label (like WhatsApp Business labels). A customer message containing one of the
// keywords puts the label on that chat automatically.
const whatsappLabelSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, default: "#00a884", match: /^#[0-9a-fA-F]{6}$/ },
    keywords: { type: [String], default: [] },
  },
  { timestamps: true }
);

whatsappLabelSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("whatsappLabel", whatsappLabelSchema);
