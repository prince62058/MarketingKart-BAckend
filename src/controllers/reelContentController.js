const reelContentModel = require("../models/reelContentModel");

const DEFAULTS = {
  bannerTitle: "Create Scroll-Stopping\nReels for",
  bannerHighlight: "Your Brand",
  bannerSubtitle: "UGC or AI – Choose Your Style,\nGrow Your Business!",
  bannerButton: "Get Started",
  sampleLabel: "Sample videos",
  trust: ["Fast Delivery", "Premium Quality", "Dedicated Support", "Grow Faster"],
  ugc: {
    tab: "UGC Reel",
    eyebrow: "Most Popular",
    title: "UGC Reel",
    subtitle: "Real People. Real Impact.",
    features: ["Authentic Creator Video", "Trending Editing & Music", "Captions & Branding"],
    options: [
      { label: "1 Reel", price: "₹1,999", offer: "" },
      { label: "2 Reels", price: "₹3,499", offer: "Save 13%" },
      { label: "3 Reels", price: "₹4,999", offer: "Save 17%" },
      { label: "4 Reels", price: "₹6,499", offer: "Save 19%" },
    ],
  },
  ai: {
    tab: "AI Reel",
    eyebrow: "",
    title: "AI Reel",
    subtitle: "Smart AI. Big Impact.",
    features: ["Stunning AI Visuals", "AI Voiceover (Optional)", "Professional Editing"],
    options: [
      { label: "1 Reel", price: "₹999", offer: "" },
      { label: "2 Reels", price: "₹1,799", offer: "Save 11%" },
      { label: "3 Reels", price: "₹2,499", offer: "Save 17%" },
      { label: "4 Reels", price: "₹3,199", offer: "Save 20%" },
    ],
  },
};

const clip = (value, max, newlines) => {
  let text = String(value ?? "").replace(/\r\n/g, "\n");
  text = newlines ? text.replace(/[^\S\n]+/g, " ") : text.replace(/\s+/g, " ");
  return text.trim().slice(0, max);
};

const kept = (value, fallback, max, newlines) => {
  if (value == null) return fallback;
  return clip(value, max, newlines) || fallback;
};

const optional = (source, key, max) => {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return null;
  return clip(source[key], max);
};

const featureLines = (value, fallback) => {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.map((item) => clip(item, 60)).filter(Boolean).slice(0, 4);
  return cleaned.length ? cleaned : fallback;
};

const pack = (value, fallback) => {
  const src = value && typeof value === "object" ? value : {};
  const written = Object.keys(src).length > 0;
  const eyebrow = optional(src, "eyebrow", 40);
  const incoming = Array.isArray(src.options) ? src.options.slice(0, 4) : [];
  const options = (incoming.length ? incoming : fallback.options)
    .map((row, index) => {
      const base = fallback.options[index] || { label: "", price: "", offer: "" };
      const offer = optional(row, "offer", 32);
      const label = clip(row && row.label, 32);
      const price = clip(row && row.price, 32);
      if (!label && !price && !base.label) return null;
      return {
        label: label || base.label || `Price ${index + 1}`,
        price: price || base.price,
        offer: offer == null ? base.offer || "" : offer,
      };
    })
    .filter((row) => row && row.label && row.price)
    .slice(0, 4);
  const priced = options.length ? options : fallback.options;
  return {
    tab: kept(src.tab, fallback.tab, 32),
    eyebrow: eyebrow == null ? (written ? "" : fallback.eyebrow) : eyebrow,
    title: kept(src.title, fallback.title, 48),
    subtitle: kept(src.subtitle, fallback.subtitle, 80),
    features: featureLines(src.features, fallback.features),
    options: priced,
  };
};

const present = (doc) => {
  const saved = doc && typeof doc === "object" ? doc : {};
  const highlight = optional(saved, "bannerHighlight", 40);
  return {
    bannerTitle: kept(saved.bannerTitle, DEFAULTS.bannerTitle, 80, true),
    bannerHighlight: highlight == null ? DEFAULTS.bannerHighlight : highlight,
    bannerSubtitle: kept(saved.bannerSubtitle, DEFAULTS.bannerSubtitle, 140, true),
    bannerButton: kept(saved.bannerButton, DEFAULTS.bannerButton, 24),
    sampleLabel: kept(saved.sampleLabel, DEFAULTS.sampleLabel, 40),
    trust: DEFAULTS.trust.map((item, index) => kept(Array.isArray(saved.trust) ? saved.trust[index] : null, item, 28)),
    ugc: pack(saved.ugc, DEFAULTS.ugc),
    ai: pack(saved.ai, DEFAULTS.ai),
  };
};

exports.getReelContent = async (req, res) => {
  const doc = await reelContentModel.findOne({ key: "reels" }).lean();
  res.json({ success: true, message: "Reel content fetched", data: present(doc) });
};

exports.saveReelContent = async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const data = present(body);
  const saved = await reelContentModel
    .findOneAndUpdate(
      { key: "reels" },
      { $set: { ...data, key: "reels" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )
    .lean();
  res.json({
    success: true,
    message: "Saved. The app shows this text, price, and offer exactly as typed.",
    data: present(saved),
  });
};
