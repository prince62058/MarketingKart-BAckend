const express = require("express");
const router = express.Router();
const premiumPlanController = require("../controllers/premiumPlanController");

// Create a plan
router.post("/create", premiumPlanController.createCategory);

// Get all plans
router.get("/all", premiumPlanController.getAllCategories);

// Update a plan
router.put("/update/:id", premiumPlanController.updateCategory);

// Delete a plan
router.delete("/delete/:id", premiumPlanController.deleteCategory);

module.exports = router;
