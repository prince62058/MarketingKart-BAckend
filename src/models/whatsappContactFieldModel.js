const mongoose = require("mongoose");

// A custom contact field, e.g. "city". `key` is the slug used in contact.custom and as the CSV header.
const whatsappContactFieldSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    key: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: ["Text", "Number", "Date", "Email"], default: "Text" },
  },
  { timestamps: true }
);

whatsappContactFieldSchema.index({ userId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("whatsappContactField", whatsappContactFieldSchema);
