// GET/PUT /api/whatsapp/panel/brands: the signed-in account's panel brands.
const express = require("express");
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const PanelBrand = require("../models/whatsappPanelBrandModel");
const businessModel = require("../models/businessModel");

const router = express.Router();
const MAX_BRANDS = 50;
const ID = /^[A-Za-z0-9_-]{6,40}$/;

const shape = (doc) => ({
  brands: (doc?.brands || []).map((b) => ({ id: b.id, name: b.name, timezone: b.timezone || "", businessId: b.businessId || null, createdAt: b.createdAt })),
  currentId: doc?.currentId || "",
});

// First visit: start from the businesses this account already runs on MarketingKart, so a
// customer who set up a business in the app finds it here without creating it again.
async function firstBrands(userId) {
  const businesses = await businessModel
    .find({ userId, disable: { $ne: true } }, "businessName createdAt")
    .sort({ createdAt: 1 })
    .limit(MAX_BRANDS)
    .lean();
  return businesses
    .filter((b) => String(b.businessName || "").trim())
    .map((b) => ({ id: String(b._id), name: String(b.businessName).trim().slice(0, 60), timezone: "", businessId: b._id, createdAt: b.createdAt || new Date() }));
}

router.get("/whatsapp/panel/brands", asyncHandler(authUser), asyncHandler(async (req, res) => {
  const userId = req.user._id;
  let doc = await PanelBrand.findOne({ userId }).lean();
  if (!doc) {
    const brands = await firstBrands(userId);
    doc = await PanelBrand.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, brands, currentId: brands[0]?.id || "" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  }
  return res.json({ success: true, data: shape(doc) });
}));

router.put("/whatsapp/panel/brands", asyncHandler(authUser), asyncHandler(async (req, res) => {
  const input = Array.isArray(req.body?.brands) ? req.body.brands : null;
  if (!input || input.length > MAX_BRANDS) {
    return res.status(400).json({ success: false, message: `Send up to ${MAX_BRANDS} brands.` });
  }
  const seen = new Set();
  const brands = [];
  for (const b of input) {
    const id = String(b?.id || "");
    const name = String(b?.name || "").trim().slice(0, 60);
    if (!ID.test(id) || !name || seen.has(id)) {
      return res.status(400).json({ success: false, message: "Each brand needs a valid id and a name." });
    }
    seen.add(id);
    brands.push({
      id,
      name,
      timezone: String(b?.timezone || "").slice(0, 60),
      createdAt: b?.createdAt && !Number.isNaN(Date.parse(b.createdAt)) ? new Date(b.createdAt) : new Date(),
    });
  }
  // A brand can only point at a business this account owns.
  const owned = new Set(
    (await businessModel.find({ userId: req.user._id }, "_id").lean()).map((b) => String(b._id))
  );
  for (const [i, b] of input.entries()) {
    if (b?.businessId && owned.has(String(b.businessId))) brands[i].businessId = b.businessId;
  }
  const currentId = seen.has(String(req.body?.currentId || "")) ? String(req.body.currentId) : brands[0]?.id || "";
  const doc = await PanelBrand.findOneAndUpdate(
    { userId: req.user._id },
    { $set: { brands, currentId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return res.json({ success: true, data: shape(doc) });
}));

module.exports = router;
