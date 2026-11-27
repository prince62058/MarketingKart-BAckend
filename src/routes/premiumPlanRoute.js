const express = require("express");
const router = express.Router();
const premiumPlanController = require("../controllers/premiumPlanController");
const { adminOnly } = require("../middlewares/authMidd");
const { requirePermission } = require("../middlewares/adminPermission");

// Create a plan
router.post("/create", adminOnly, requirePermission("PLAN"), premiumPlanController.createCategory);

// Get all plans
router.get("/all", premiumPlanController.getAllCategories);

// Update a plan
router.put("/update/:id", adminOnly, requirePermission("PLAN"), premiumPlanController.updateCategory);

// Delete a plan
router.delete("/delete/:id", adminOnly, requirePermission("PLAN"), premiumPlanController.deleteCategory);

module.exports = router;
