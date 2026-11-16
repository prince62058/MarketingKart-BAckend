const mongoose = require("mongoose");

// A Conversions API for Business Messaging event (lead or purchase) reported for one WhatsApp
// conversation. The unique index on conversation + event name is what guarantees that a
// conversation is reported to Meta at most once per event.
const whatsappConversionEventSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "whatsappConversation", required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "business" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    wabaId: String,
    phoneNumberId: String,
    datasetId: String,
    eventName: { type: String, enum: ["LeadSubmitted", "Purchase"], required: true },
    // Sent to Meta as event_id; the same id is reused when a failed send is retried.
    eventId: { type: String, required: true },
    eventTime: Date,
    value: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    adId: String,
    status: { type: String, enum: ["SENDING", "SENT", "FAILED"], default: "SENDING" },
    attempts: { type: Number, default: 1 },
    // When the current send started. A SENDING row older than the lock window can be taken over.
    lockedAt: Date,
    sentAt: Date,
    eventsReceived: Number,
    fbtraceId: String,
    errorCode: String,
    errorMessage: String,
  },
  { timestamps: true }
);

whatsappConversionEventSchema.index({ conversationId: 1, eventName: 1 }, { unique: true });

module.exports = mongoose.model("whatsappConversionEvent", whatsappConversionEventSchema);
