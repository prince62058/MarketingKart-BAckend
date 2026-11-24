const mongoose = require("mongoose");

const whatsappAccountMenuSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    action: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: "", trim: true },
    sortOrder: { type: Number, default: 0 },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappAccountMenu", whatsappAccountMenuSchema);
