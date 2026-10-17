const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    id: String,
    title: String,
    status: { type: String, enum: ["Completed", "Rendering", "Draft", "Failed"], default: "Draft" },
    format: String,
    duration: String,
    presenter: String,
    progress: { type: Number, default: 0 },
    script: String,
    badgeText: String,
    voice: String,
    language: String,
    speed: Number,
    music: String,
    captions: String,
    // Provider render
    heygenVideoId: String,
    avatarLookId: String,
    voiceId: String,
    videoUrl: String,
    thumbnailUrl: String,
    // HeyGen links expire after 7 days; this marks when a provider-hosted url was fetched.
    providerUrlAt: Date,
    durationSeconds: Number,
    error: String,
    cost: Number,
    refunded: { type: Boolean, default: false },
    lastCheckedAt: Date,
    renderStartedAt: Date,
    completedAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const avatarSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    kind: String,
    status: String,
    format: String,
    voice: String,
    voiceName: String,
    pitch: String,
    attire: String,
    background: String,
    source: String,
    heygenLookId: String,
    heygenGroupId: String,
    previewUrl: String,
    previewVideoUrl: String,
    error: String,
    lastCheckedAt: Date,
    // Video (digital twin) avatars: footage upload, HeyGen consent, and what creating it cost.
    heygenAssetId: String,
    consentStatus: String,
    defaultVoiceId: String,
    contentType: String,
    sizeBytes: Number,
    uploadExpiresAt: Date,
    cost: Number,
    refunded: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// pending_payment -> paid. A wallet payment passes through wallet_processing while the
// balance is debited, so an interrupted request can be finished instead of charged twice.
const orderSchema = new mongoose.Schema(
  {
    id: String,
    kind: String,
    itemId: String,
    billing: String,
    price: Number,
    amountPaise: Number,
    credits: Number,
    termDays: Number,
    method: { type: String, enum: ["razorpay", "wallet"], default: "razorpay" },
    status: { type: String, default: "pending_payment" },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    methodLabel: String,
    claimedAt: Date,
    paidAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const studioSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true, index: true },
    businessId: { type: String, default: null },
    credits: { type: Number, default: 120 },
    plan: { type: String, default: "free" },
    // When the paid term of `plan` ends; after this the studio is on the free plan again.
    planRenewsAt: Date,
    planBilling: String,
    goal: { type: String, default: null },
    projects: [projectSchema],
    avatars: [avatarSchema],
    voiceovers: [
      {
        _id: false,
        id: String,
        language: String,
        voice: String,
        script: String,
        status: String,
        audioUrl: String,
        durationSeconds: Number,
        cost: Number,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    orders: [orderSchema],
    enterprise: {
      name: String,
      phone: String,
      company: String,
      status: String,
      note: String,
      updatedAt: Date,
    },
  },
  { timestamps: true },
);

studioSchema.index({ userId: 1, businessId: 1 }, { unique: true });
// The Razorpay webhook finds the studio from nothing but the order id.
studioSchema.index({ "orders.razorpayOrderId": 1 });

module.exports = mongoose.models.AiVideoStudio || mongoose.model("AiVideoStudio", studioSchema);
