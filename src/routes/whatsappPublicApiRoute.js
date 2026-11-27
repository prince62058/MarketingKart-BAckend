const express = require("express");
const apiKeyAuth = require("../middlewares/apiKeyAuth");
const ctrl = require("../controllers/whatsappDeveloperController");

const router = express.Router();

router.use(apiKeyAuth);
// A suspended customer, or one whose Developer API was switched off by an admin, gets nothing here.
router.use(async (req, res, next) => {
  try { await require("../services/whatsappControls").check(req.user._id, "api"); return next(); }
  catch (error) { return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message }); }
});
const contract = require("../services/developerContract");
router.use(async (req,res,next) => {
  try { await contract.rateLimit(req.user._id); return next(); }
  catch(error) {
    if(error.status === 429) res.set("Retry-After",String(60-Math.floor(Date.now()/1000)%60));
    return res.status(error.status || 503).json({success:false,message:error.status ? error.message : "API metering is unavailable"});
  }
});
router.get("/account/package", async (req, res, next) => {
  try { res.json({success:true, data:await contract.read(req.user._id)}); } catch (error) { next(error); }
});
router.post("/chatbot/replies", (req, res, next) => {
  if (!["both","chatbot"].includes(req.apiKey.service)) return res.status(403).json({success:false,message:"Chatbot access is missing from this key"});
  if (req.apiKey.access === "read") return res.status(403).json({success:false,message:"This project key is read-only"});
  return next();
}, ctrl.chat);
router.use(async (req, res, next) => {
  if (req.apiKey.service === "chatbot") return res.status(403).json({success:false,message:"WhatsApp access is missing from this key"});
  // Every customer can use the WhatsApp API: an API package pays for messages when
  // one is active, otherwise template messages are charged to the WhatsApp wallet.
  try { req.apiBilling = (await contract.hasActive(req.user._id, "whatsapp")) ? "package" : "wallet"; next(); }
  catch (error) { res.status(error.status || 500).json({success:false,message:error.message}); }
});
router.get("/account", ctrl.apiAccount);
router.get("/templates", ctrl.apiTemplates);
router.get("/messages", ctrl.apiMessages);
router.get("/messages/:id", ctrl.apiMessage);
router.get("/messages/:id/status", ctrl.apiMessage);
router.post("/messages", (req, res, next) => {
  if ((req.apiKey.access ?? "send") !== "send") {
    return res.status(403).json({ success: false, message: "This project key is read-only" });
  }
  return next();
}, ctrl.sendMessage);

module.exports = router;
