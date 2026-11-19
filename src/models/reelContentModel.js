const mongoose = require("mongoose");

const optionSchema = new mongoose.Schema(
  {
    label: { type: String, default: "", trim: true },
    price: { type: String, default: "", trim: true },
    offer: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const packageSchema = new mongoose.Schema(
  {
    tab: { type: String, default: "", trim: true },
    eyebrow: { type: String, default: "", trim: true },
    title: { type: String, default: "", trim: true },
    subtitle: { type: String, default: "", trim: true },
    features: { type: [String], default: [] },
    options: { type: [optionSchema], default: [] },
  },
  { _id: false }
);

const reelContentSchema = new mongoose.Schema(
  {
    key: { type: String, default: "reels", unique: true },
    bannerTitle: { type: String, default: "", trim: true },
    bannerHighlight: { type: String, default: "", trim: true },
    bannerSubtitle: { type: String, default: "", trim: true },
    bannerButton: { type: String, default: "", trim: true },
    sampleLabel: { type: String, default: "", trim: true },
    trust: { type: [String], default: [] },
    ugc: { type: packageSchema, default: () => ({}) },
    ai: { type: packageSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model("reelContentModel", reelContentSchema);
