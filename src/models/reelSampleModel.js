const mongoose = require("mongoose");

const reelSampleSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["ugc", "ai"], required: true },
    slot: { type: Number, required: true, min: 1, max: 3 },
    title: { type: String, default: "", trim: true },
    video: { type: String, default: "", trim: true },
    thumbnail: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

reelSampleSchema.index({ kind: 1, slot: 1 }, { unique: true });

module.exports = mongoose.model("reelSampleModel", reelSampleSchema);
