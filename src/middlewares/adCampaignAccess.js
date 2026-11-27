const Campaign = require('../models/internalCampiagnModel');
const Business = require('../models/businessModel');
// Statuses a customer may set on their own ad. Admin-only routes keep their own checks.
const CUSTOMER_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'DELETED'];

exports.requireDeliveryAccess = async (req, res, next) => {
  const fromBody = req.body?.internalCampaignId;
  const fromQuery = req.query?.internalCampaignId;
  // The handlers read the id from the query: the campaign checked here must be the one they act on.
  if (fromBody && fromQuery && String(fromBody) !== String(fromQuery)) {
    return res.status(400).json({ success: false, message: 'Send the campaign ID once' });
  }
  const id = fromBody || fromQuery;
  if (!id || !require('mongoose').isValidObjectId(id)) return res.status(400).json({ success: false, message: 'Campaign ID is required' });
  req.query.internalCampaignId = String(id);
  if (req.body && typeof req.body === 'object') req.body.internalCampaignId = String(id);
  const status = req.query?.status ?? req.body?.status;
  if (status !== undefined && (req.authUser || req.user).userType !== 'ADMIN' && !CUSTOMER_STATUSES.includes(String(status))) {
    return res.status(400).json({ success: false, message: 'Unknown status' });
  }
  const campaign = await Campaign.findById(id).lean();
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
  const caller = req.authUser || req.user;
  if (caller.userType !== 'ADMIN') {
    const business = await Business.findOne({ _id: campaign.businessId, userId: caller._id }).lean();
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
