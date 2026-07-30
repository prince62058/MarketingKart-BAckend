const PremiumPlan = require("../models/premiumPlanModel");
const responseBuilder = require("../utils/responseBuilder");
const { statusCodes, apiResponseStatusCode, defaultResponseMessage } = require("../Message/defaultMessage");


// Create new Premium Plan
exports.createCategory = async (req, res) => {
  try {
    const { name, icon, value, color, darkColor, lightBg, accentBg, disclaimer, plans } = req.body;
    
    // Check if plan exists
    const existing = await PremiumPlan.findOne({ value });
    if (existing) {
      return res.status(statusCodes["Bad Request"]).json(responseBuilder(apiResponseStatusCode[400], "Premium Plan with this value already exists"));
    }

    const plan = new PremiumPlan({
      name,
      icon,
      value,
      color,
      darkColor,
      lightBg,
      accentBg,
      disclaimer,
      plans: plans || []
    });

    await plan.save();
    if (global.io) {
      global.io.emit("premiumPlansUpdated", { action: "create", plan });
    }
    return res.status(statusCodes.Created).json(responseBuilder(apiResponseStatusCode[201], "Premium Plan created successfully", plan));
  } catch (error) {
    return res.status(statusCodes["Internal Server Error"]).json(responseBuilder(apiResponseStatusCode[500], error.message));
  }
};


// Get all Premium Plans (Admin should see all)
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await PremiumPlan.find({});
    return res.status(statusCodes.OK).json(responseBuilder(apiResponseStatusCode[200], "Premium Plans fetched successfully", categories));
  } catch (error) {
    return res.status(statusCodes["Internal Server Error"]).json(responseBuilder(apiResponseStatusCode[500], error.message));
  }
};


// Update Premium Plan (including plans)
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, value, status, color, darkColor, lightBg, accentBg, disclaimer, plans } = req.body;

    const plan = await PremiumPlan.findByIdAndUpdate(
      id,
      { name, icon, value, status, color, darkColor, lightBg, accentBg, disclaimer, plans },
      { new: true }
    );

    if (!plan) {
      return res.status(statusCodes["Not Found"]).json(responseBuilder(apiResponseStatusCode[404], "Premium Plan not found"));
    }

    if (global.io) {
      global.io.emit("premiumPlansUpdated", { action: "update", plan });
    }

    return res.status(statusCodes.OK).json(responseBuilder(apiResponseStatusCode[200], "Premium Plan updated successfully", plan));
  } catch (error) {
    return res.status(statusCodes["Internal Server Error"]).json(responseBuilder(apiResponseStatusCode[500], error.message));
  }
};


// Delete Premium Plan
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await PremiumPlan.findByIdAndDelete(id);
    
    if (!plan) {
      return res.status(statusCodes["Not Found"]).json(responseBuilder(apiResponseStatusCode[404], "Premium Plan not found"));
    }

    if (global.io) {
      global.io.emit("premiumPlansUpdated", { action: "delete", id });
    }

    return res.status(statusCodes.OK).json(responseBuilder(apiResponseStatusCode[200], "Premium Plan deleted successfully"));
  } catch (error) {
    return res.status(statusCodes["Internal Server Error"]).json(responseBuilder(apiResponseStatusCode[500], error.message));
  }
};

