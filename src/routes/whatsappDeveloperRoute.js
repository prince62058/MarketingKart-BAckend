const express = require("express");
const { authUser } = require("../middlewares/authMidd");
const ctrl = require("../controllers/whatsappDeveloperController");

const router = express.Router();

router.get("/whatsapp/developer/desk", authUser, ctrl.desk);
router.get("/whatsapp/developer/calls", authUser, ctrl.calls);
router.get("/whatsapp/developer/directory", authUser, ctrl.directory);
router.get("/whatsapp/developer/overview", authUser, ctrl.overview);
router.get("/whatsapp/developer/keys", authUser, ctrl.listKeys);
router.post("/whatsapp/developer/keys", authUser, ctrl.createKey);
router.post("/whatsapp/developer/keys/:keyId/revoke", authUser, ctrl.revokeKey);
router.post("/whatsapp/developer/keys/:keyId/regenerate", authUser, ctrl.regenerateKey);
router.get("/whatsapp/developer/webhook", authUser, ctrl.getWebhook);
router.put("/whatsapp/developer/webhook", authUser, ctrl.saveWebhook);
router.post("/whatsapp/developer/webhook/rotate", authUser, ctrl.rotateWebhook);

router.put("/whatsapp/developer/contracts/:userId", authUser, ctrl.saveContract);

router.route("/whatsapp/developer/bot-profile").get(authUser, ctrl.botProfile).put(authUser, ctrl.botProfile);

router.get("/whatsapp/developer/invoices", authUser, ctrl.invoices);
router.route("/whatsapp/developer/customers/:userId/invoices").get(authUser,ctrl.invoices).post(authUser,ctrl.invoices);
router.post("/whatsapp/developer/invoices/:id/checkout",authUser,ctrl.checkoutInvoice);

router.post("/whatsapp/developer/payment-events",async (req,res) => {
  try {
    await require("../services/developerInvoices").receivePayment(req.rawBody,req.get("x-razorpay-signature"),req.body);
    return res.sendStatus(204);
  } catch(error) { return res.status(error.status || 500).json({success:false,message:"Payment event could not be accepted"}); }
});

router.get("/whatsapp/developer/customers",authUser,ctrl.customers);
router.post("/whatsapp/developer/customer-lookup",authUser,ctrl.customers);

router.post("/whatsapp/developer/send",authUser,ctrl.panelSend);

module.exports = router;
