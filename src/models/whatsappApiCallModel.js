const mongoose = require("mongoose");

const whatsappApiCallSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    keyId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappApiKey", required: true, index: true },
    idempotencyKey: { type: String, default: undefined },
    to: { type: String, default: "" },
    kind: { type: String, enum: ["text", "template"], required: true },
    templateName: { type: String, default: "" },
    category: { type: String, default: "" },
    status: { type: String, default: "SENT" },
    billSource: { type: String, default: null },
    billPaise: { type: Number, default: 0 },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappMessage", default: null },
    metaMessageId: { type: String, default: null, index: true },
    errorMessage: { type: String, default: "" },
  },
  { timestamps: true }
);

whatsappApiCallSchema.index(
  { keyId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

module.exports = mongoose.model("whatsappApiCall", whatsappApiCallSchema);
