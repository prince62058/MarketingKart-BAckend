const mongoose = require("mongoose");

const whatsappDeveloperWebhookSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, unique: true },
    url: { type: String, default: "" },
    secret: { type: String, required: true },
    enabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappDeveloperWebhook", whatsappDeveloperWebhookSchema);
