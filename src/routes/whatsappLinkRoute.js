// Link & QR links, chat labels, and labels on a chat.
const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const svc = require("../services/whatsappLinkService");

const handle = (fn, status = 200) => async (req, res) => {
  try {
    res.status(status).json({ success: true, data: await fn(req) });
  } catch (error) {
    if (error instanceof svc.LinkError) return res.status(error.status).json({ success: false, message: error.message });
    console.error("[whatsapp links]", error.message);
    res.status(500).json({ success: false, message: "Something went wrong. Try again." });
  }
};

router.get("/whatsapp/labels", authUser, handle((req) => svc.listLabels(req.user._id)));
router.post("/whatsapp/labels", authUser, handle((req) => svc.createLabel(req.user._id, req.body), 201));
router.put("/whatsapp/labels/:labelId", authUser, handle((req) => svc.updateLabel(req.user._id, req.params.labelId, req.body)));
router.delete("/whatsapp/labels/:labelId", authUser, handle((req) => svc.deleteLabel(req.user._id, req.params.labelId)));

router.get("/whatsapp/links", authUser, handle((req) => svc.listLinks(req.user._id)));
router.post("/whatsapp/links", authUser, handle((req) => svc.createLink(req.user._id, req.body), 201));
router.put("/whatsapp/links/:linkId", authUser, handle((req) => svc.updateLink(req.user._id, req.params.linkId, req.body)));
router.delete("/whatsapp/links/:linkId", authUser, handle((req) => svc.deleteLink(req.user._id, req.params.linkId)));

router.put("/whatsapp/conversations/:conversationId/labels", authUser, handle((req) => svc.setConversationLabels(req.user._id, req.params.conversationId, req.body?.labelIds)));

module.exports = router;
