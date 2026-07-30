const express = require("express");
const router = express.Router();
const {
  getTransactionById,
  createTransactions,
  listTransactions,
  createOrder
} = require("../controllers/transtionController");

// Transaction routes
router.post("/createOrder", createOrder);
router.post("/transactions", createTransactions);
router.get("/transactions", listTransactions);
router.get("/transactionsById", getTransactionById);

module.exports = router;
