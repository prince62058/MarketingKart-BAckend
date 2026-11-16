const conversions = require("../services/whatsappConversionService");

// The business owner marks a Click-to-WhatsApp ad chat as a lead or a sale, and the service reports
// it to Meta's Conversions API for Business Messaging (at most once per chat and event).

// GET /api/whatsapp/chat/conversations/:conversationId/conversion
exports.getConversion = async (req, res) => {
  try {
    const result = await conversions.getConversionState({
      userId: req.user._id,
      conversationId: req.params.conversationId,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("[WA Conversions] status failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not load the conversion status" });
  }
};

// POST /api/whatsapp/chat/conversations/:conversationId/conversion  { event: "lead"|"purchase", value }
exports.markConversion = async (req, res) => {
  try {
    const { event, value } = req.body || {};
    const result = await conversions.markConversation({
      userId: req.user._id,
      conversationId: req.params.conversationId,
      event,
      value,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("[WA Conversions] mark failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not report this conversion" });
  }
};
