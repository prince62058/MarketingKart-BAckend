const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const asyncHandler = require("../utils/asyncHandler");
const {
  getTransactionById,
  createTransactions,
  listTransactions,
  createOrder
} = require("../controllers/transtionController");

// Transaction routes
router.post("/createOrder", asyncHandler(authUser), createOrder);
router.post("/transactions", asyncHandler(authUser), createTransactions);
router.get("/transactions", asyncHandler(authUser), listTransactions);
router.get("/transactionsById", asyncHandler(authUser), getTransactionById);

module.exports = router;
