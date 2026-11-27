const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/whatsappWalletController");
const { authUser } = require("../middlewares/authMidd");
const { staffPermission } = require("../middlewares/adminPermission");

// Razorpay order
router.post("/whatsapp/wallet/create-order", authUser, ctrl.createOrder);

// Wallet
router.post("/whatsapp/wallet/add-money", authUser, (req, res, next) => (req.body?.userId ? staffPermission("WA_TRANSACTIONS")(req, res, next) : next()), ctrl.addMoney);
router.get("/whatsapp/wallet/balance", authUser, ctrl.getWalletBalance);

// Transactions
router.get("/whatsapp/wallet/transactions", authUser, ctrl.getTransactions);
router.get("/whatsapp/wallet/all-transactions", authUser, staffPermission("WA_TRANSACTIONS"), ctrl.getAllTransactions);

// Plans
router.post("/whatsapp/plans", authUser, staffPermission("WA_PLANS"), ctrl.createPlan);
router.get("/whatsapp/plans", authUser, ctrl.getPlans);
router.put("/whatsapp/plans/:planId", authUser, staffPermission("WA_PLANS"), ctrl.updatePlan);
router.put("/whatsapp/plans/:planId/toggle", authUser, staffPermission("WA_PLANS"), ctrl.togglePlan);

// Purchase & Subscription
router.post("/whatsapp/plans/purchase", authUser, ctrl.purchasePlan);
router.get("/whatsapp/subscription", authUser, ctrl.getSubscription);

router.get("/whatsapp/pricing", authUser, ctrl.getPricing);
router.put("/whatsapp/pricing/:category", authUser, staffPermission("WA_PLANS"), ctrl.updatePricing);

module.exports = router;
