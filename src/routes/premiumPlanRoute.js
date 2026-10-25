const express = require("express");
const router = express.Router();
const premiumPlanController = require("../controllers/premiumPlanController");
const { adminOnly } = require("../middlewares/authMidd");

// Create a plan
router.post("/create", adminOnly, premiumPlanController.createCategory);

// Get all plans
router.get("/all", premiumPlanController.getAllCategories);

// Update a plan
router.put("/update/:id", adminOnly, premiumPlanController.updateCategory);

// Delete a plan
router.delete("/delete/:id", adminOnly, premiumPlanController.deleteCategory);

module.exports = router;
