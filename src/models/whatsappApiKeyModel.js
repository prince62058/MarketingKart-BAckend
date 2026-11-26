const mongoose = require("mongoose");

const whatsappApiKeySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    name: { type: String, required: true, trim: true },
    prefix: { type: String, required: true },
    last4: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
    service: { type:String, enum:["whatsapp","chatbot","both"], default:"whatsapp" },
    access: { type: String, enum: ["read", "send"], default: "send" },
    lastUsedAt: { type: Date, default: null },
    callCount: { type: Number, default: 0 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("whatsappApiKey", whatsappApiKeySchema);
