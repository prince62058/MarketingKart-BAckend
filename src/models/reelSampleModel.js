const mongoose = require("mongoose");

const reelSampleSchema = new mongoose.Schema(
  {
    slot: { type: Number, required: true, unique: true, min: 1, max: 3 },
    title: { type: String, default: "", trim: true },
    video: { type: String, default: "", trim: true },
    thumbnail: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("reelSampleModel", reelSampleSchema);
