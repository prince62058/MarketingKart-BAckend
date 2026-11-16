const mongoose = require("mongoose");

// One completed WhatsApp Flow (an inbound `nfm_reply` message).
const whatsappFlowResponseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "business", default: null },
    flowId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappFlow", default: null },
    metaFlowId: { type: String, default: null },
    wabaId: { type: String, default: null },
    phoneNumberId: { type: String, default: null },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappConversation", default: null },
    customerPhone: { type: String, default: null },
    customerName: { type: String, default: null },
    wamid: { type: String, required: true, unique: true },
    answers: { type: [{ _id: false, key: String, label: String, value: String }], default: [] },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

whatsappFlowResponseSchema.index({ userId: 1, flowId: 1, receivedAt: -1 });

module.exports = mongoose.model("whatsappFlowResponse", whatsappFlowResponseSchema);
