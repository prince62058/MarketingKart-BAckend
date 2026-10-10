const Campaign = require('../models/internalCampiagnModel');
const Business = require('../models/businessModel');
exports.requireDeliveryAccess = async (req, res, next) => {
  const id = req.body?.internalCampaignId || req.query?.internalCampaignId;
  if (!id) return res.status(400).json({ success: false, message: 'Campaign ID is required' });
  const campaign = await Campaign.findById(id).lean();
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
  if (req.user.userType !== 'ADMIN') {
    const business = await Business.findOne({ _id: campaign.businessId, userId: req.user._id }).lean();
    if (!business) return res.status(403).json({ success: false, message: 'Campaign access denied' });
  }
  if (campaign.approvalStatus && (campaign.approvalStatus !== 'APPROVED' || campaign.deliveryJobState !== 'DONE')) {
    return res.status(409).json({ success: false, message: 'Campaign is awaiting admin approval or Meta submission. Delivery cannot be changed yet.' });
  }
  if (campaign.approvalStatus && req.path === '/resetAd') {
    return res.status(409).json({ success: false, message: 'Create a new ad request to renew this campaign. Every new paid campaign requires admin approval.' });
  }
  next();
};
