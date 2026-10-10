const service = require('../services/adApprovalService');
exports.review = async (req, res) => {
  try {
    const { internalCampaignId, action, reason } = req.body;
    if (!internalCampaignId) throw new Error('Campaign ID is required');
    const data = action === 'APPROVE'
      ? await service.approveCampaign(internalCampaignId, req.user._id)
      : action === 'REJECT'
        ? await service.rejectCampaign(internalCampaignId, req.user._id, reason)
        : action === 'RETRY' ? await service.retryCampaign(internalCampaignId) : null;
    if (!data) throw new Error('Invalid review action');
    return res.json({ success: true, message: action === 'REJECT' ? 'Ad rejected and full payment refunded to wallet' : 'Approved ad queued for Meta submission', data });
  } catch (error) { return res.status(409).json({ success: false, message: error.message }); }
};
