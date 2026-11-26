const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  whatsapp: { type: Boolean, default: false },
  chatbot: { type: Boolean, default: false },
  requestsPerMinute: { type:Number, min:1, max:10000, default:60 },
  expiresAt: { type: Date, required: true },
  whatsappLimit: { type: Number, min: 0, required: true },
  chatbotLimit: { type: Number, min: 0, required: true },
  whatsappUsed: { type: Number, default: 0 },
  chatbotUsed: { type: Number, default: 0 },
  packageFeeRupees: { type: Number, min: 0, required: true },
  billingReference: { type: String, maxlength: 100, default: "" },
  botProfile: {
    businessName: { type: String, maxlength: 120, default: "" },
    systemPrompt: { type: String, maxlength: 4000, default: "" },
    faqs: [{ _id: false, question: { type: String, maxlength: 300 }, answer: { type: String, maxlength: 1000 } }],
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true });
module.exports = mongoose.model("developerContract", schema);
