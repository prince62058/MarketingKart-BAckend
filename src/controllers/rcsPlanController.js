const RcsPlan = require("../models/rcsPlanModel");
const rcsSettings = require("../services/rcsSettingsService");

const isAdminUser = (user) =>
  user?.userType === "ADMIN" || user?.role === "ADMIN" || user?.userType === "STAFF";

exports.createPlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can create plans" });
    }
    const plan = await RcsPlan.create(req.body);
    return res.status(201).json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPlans = async (req, res) => {
  try {
    const filter =
      req.query.all === "true"
        ? {}
        : { disable: false, monthlyPrice: { $gt: 0 } };
    const plans = await RcsPlan.find(filter).sort({ sortOrder: 1, monthlyPrice: 1 });
    return res.status(200).json({ success: true, data: plans });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can update plans" });
    }
    const plan = await RcsPlan.findByIdAndUpdate(req.params.planId, req.body, { new: true });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    return res.status(200).json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.togglePlan = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can toggle plans" });
    }
    const plan = await RcsPlan.findById(req.params.planId);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    plan.disable = !plan.disable;
    await plan.save();
    return res.status(200).json({ success: true, data: plan });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can view RCS settings" });
    }
    const data = await rcsSettings.get({ fresh: true });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can update RCS settings" });
    }
    const data = await rcsSettings.update(req.body, req.user);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.getCatalog = async (req, res) => {
  try {
    const data = await rcsSettings.getCatalog();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
