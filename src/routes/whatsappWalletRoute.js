const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/whatsappWalletController");
const { authUser } = require("../middlewares/authMidd");

// Razorpay order
router.post("/whatsapp/wallet/create-order", authUser, ctrl.createOrder);

// Wallet
router.post("/whatsapp/wallet/add-money", authUser, ctrl.addMoney);
router.get("/whatsapp/wallet/balance", authUser, ctrl.getWalletBalance);

// Transactions
router.get("/whatsapp/wallet/transactions", authUser, ctrl.getTransactions);
router.get("/whatsapp/wallet/all-transactions", authUser, ctrl.getAllTransactions);

// Plans
router.post("/whatsapp/plans", authUser, ctrl.createPlan);
router.get("/whatsapp/plans", authUser, ctrl.getPlans);
router.put("/whatsapp/plans/:planId", authUser, ctrl.updatePlan);
router.put("/whatsapp/plans/:planId/toggle", authUser, ctrl.togglePlan);

// Purchase & Subscription
router.post("/whatsapp/plans/purchase", authUser, ctrl.purchasePlan);
router.get("/whatsapp/subscription", authUser, ctrl.getSubscription);

module.exports = router;
