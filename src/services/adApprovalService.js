const mongoose = require('mongoose');
const Campaign = require('../models/internalCampiagnModel');
const Business = require('../models/businessModel');
const User = require('../models/userModel');
const Transaction = require('../models/transtionModel');
const External = require('../models/ExternalCampaignsModel');
const axios = require('axios');
const { assertGeoMatches } = require('../helpers/metaGeoTargeting');
const { syncCampaignStatuses } = require('../helpers/metaStatusHelper');

const fundingIssue = message => /insufficient.*(fund|balance)|payment|billing|spending limit|account.*balance/i.test(message || '');
const retryableIssue = error => fundingIssue(error.message) || error.response?.data?.error?.is_transient || /timeout|ECONNRESET|ETIMEDOUT|temporar/i.test(error.message || '');
const shiftedSchedule = (payload, now = Date.now()) => {
  const start = Number(payload.startDate), end = Number(payload.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Invalid campaign dates');
  const nextStart = Math.max(start, Math.ceil(now / 1000) + 120);
  return { ...payload, startDate: nextStart, endDate: nextStart + end - start };
};

async function approveCampaign(id, adminId) {
  const campaign = await Campaign.findById(id).select('+submissionPayload');
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.approvalStatus !== 'PENDING' || campaign.paymentStatus !== 'APPROVED' || campaign.refundedAt) throw new Error('Only paid, pending campaigns can be approved');
  const payload = shiftedSchedule(campaign.submissionPayload || {});
  const saved = await Campaign.findOneAndUpdate(
    { _id: id, approvalStatus: 'PENDING', paymentStatus: 'APPROVED', refundedAt: null },
    { $set: { approvalStatus: 'APPROVED', approvedBy: adminId, approvedAt: new Date(), status: 'PREPARING',
      submissionPayload: payload, startDate: new Date(payload.startDate * 1000).toUTCString(), endDate: new Date(payload.endDate * 1000).toUTCString(),
      deliveryJobState: 'QUEUED', nextDeliveryAttemptAt: new Date(), metaCreateError: null } }, { new: true },
  );
  if (!saved) throw new Error('This request has already been reviewed');
  return saved;
}

async function rejectCampaign(id, adminId, reason) {
  if (!String(reason || '').trim()) throw new Error('A rejection reason is required');
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const campaign = await Campaign.findOneAndUpdate(
        { _id: id, approvalStatus: 'PENDING', paymentStatus: 'APPROVED', refundedAt: null },
        { $set: { approvalStatus: 'REJECTED', status: 'ADMIN_REJECTED', rejectionReason: String(reason).trim(),
          approvedBy: adminId, refundedAt: new Date() } }, { new: true, session },
      );
      if (!campaign) throw new Error('Only paid, pending requests can be rejected; this request may already have been reviewed');
      if (!(campaign.chargedAmount > 0) || !campaign.chargedUserId) throw new Error('Original debit details are missing; refund was not applied');
      const refund = await User.updateOne({ _id: campaign.chargedUserId }, { $inc: { wallet: campaign.chargedAmount } }, { session });
      if (!refund.matchedCount) throw new Error('Wallet owner not found');
      await Transaction.create([{ type: 'CREDIT', walletType: 'MAIN', userId: campaign.chargedUserId,
        businessId: campaign.businessId, adsId: campaign._id, amount: campaign.chargedAmount,
        transactionId: `admin_rejection_${campaign._id}`, description: 'Full wallet refund — ad rejected by admin' }], { session });
      result = campaign;
    });
    return result;
  } finally { await session.endSession(); }
}

async function retryCampaign(id) {
  const result = await Campaign.findOneAndUpdate(
    { _id: id, approvalStatus: 'APPROVED', paymentStatus: 'APPROVED', refundedAt: null, deliveryJobState: 'FAILED' },
    { $set: { deliveryJobState: 'QUEUED', nextDeliveryAttemptAt: new Date(), status: 'PREPARING' } }, { new: true },
  );
  if (!result) throw new Error('Only an approved delivery failure can be retried');
  return result;
}

async function deliverCampaign(campaign, deps = {}) {
  const models = deps.models || { Campaign, Business, External };
  const api = deps.api || axios;
  if (campaign.approvalStatus !== 'APPROVED' || campaign.paymentStatus !== 'APPROVED' || campaign.refundedAt) throw new Error('Admin approval and payment are required');
  const business = await models.Business.findById(campaign.businessId).lean();
  if (!business || business.pageId !== campaign.submissionPageId) throw new Error('Linked Facebook Page changed. Admin must review a new ad request for the new Page.');
  if (campaign.deliveryJobState === 'DONE') return;
  const refreshedPayload = campaign.submissionPayload ? shiftedSchedule(campaign.submissionPayload) : null;
  if (!campaign.mainAdId || !campaign.facebookAdSetId) {
    if (refreshedPayload) {
      campaign.submissionPayload = refreshedPayload;
      await models.Campaign.updateOne({ _id: campaign._id }, { $set: {
        submissionPayload: refreshedPayload, startDate: new Date(refreshedPayload.startDate * 1000).toUTCString(),
        endDate: new Date(refreshedPayload.endDate * 1000).toUTCString(),
      } });
    }
    const build = deps.build || require('../controllers/adsDetailsController').buildApprovedCampaign;
    await build(campaign._id, campaign.submissionPayload);
    campaign = await models.Campaign.findById(campaign._id);
  }
  const external = await models.External.findById(campaign.externalCampiagnId);
  if (!campaign.mainAdId || !campaign.facebookAdSetId || !external?.meta_CampaignId) throw new Error('Meta delivery objects are incomplete');
  const requestOptions = { headers: { Authorization: `Bearer ${process.env.systemUserAccessToken}` }, timeout: 20000 };
  // Verify the saved ad-set targeting before any ACTIVE write. Never spend on a widened area.
  if (!campaign.location) throw new Error('Saved location targeting is missing; delivery blocked');
  {
    const { data: savedAdSet } = await api.get(`https://graph.facebook.com/v22.0/${campaign.facebookAdSetId}`, {
      ...requestOptions, params: { fields: 'targeting' },
    });
    const expected = campaign.location;
    assertGeoMatches(expected, savedAdSet.targeting?.geo_locations);
    if (savedAdSet.targeting?.excluded_geo_locations && Object.values(savedAdSet.targeting.excluded_geo_locations).some(v => Array.isArray(v) && v.length)) throw new Error('Meta returned unexpected location exclusions');
    await models.Campaign.updateOne({ _id: campaign._id }, { $set: { metaGeoVerifiedAt: new Date() } });
  }
  // Retry after a billing delay only moves dates while the parent remains paused.
  // A response lost after activation must not extend an already running ad.
  if (refreshedPayload) {
    const { data: parent } = await api.get(`https://graph.facebook.com/v22.0/${external.meta_CampaignId}`, {
      ...requestOptions, params: { fields: 'status' },
    });
    if (parent.status === 'PAUSED') {
      await api.post(`https://graph.facebook.com/v22.0/${campaign.facebookAdSetId}`, {
        start_time: new Date(refreshedPayload.startDate * 1000).toISOString(),
        end_time: new Date(refreshedPayload.endDate * 1000).toISOString(),
      }, requestOptions);
      await models.Campaign.updateOne({ _id: campaign._id }, { $set: {
        submissionPayload: refreshedPayload, startDate: new Date(refreshedPayload.startDate * 1000).toUTCString(),
        endDate: new Date(refreshedPayload.endDate * 1000).toUTCString(),
      } });
    }
  }
  // A daily budget may fluctuate at Meta; the campaign cap bounds total delivery.
  if (campaign.totalBudget > 0) await api.post(`https://graph.facebook.com/v22.0/${external.meta_CampaignId}`,
    { spend_cap: Math.floor(campaign.totalBudget * 100) }, requestOptions);
  // Enable the parent last. A partially built ad must never spend.
  for (const id of [campaign.mainAdId, campaign.facebookAdSetId, external.meta_CampaignId]) {
    await api.post(`https://graph.facebook.com/v22.0/${id}`, { status: 'ACTIVE' }, {
      headers: { Authorization: `Bearer ${process.env.systemUserAccessToken}` }, timeout: 20000,
    });
  }
  await models.Campaign.updateOne({ _id: campaign._id, approvalStatus: 'APPROVED' }, {
    $set: { deliveryJobState: 'DONE', status: 'PREPARING', metaCreateError: null, metaStatusReason: null },
    $unset: { deliveryJobLease: 1, nextDeliveryAttemptAt: 1 },
  });
  if (!deps.models) await syncCampaignStatuses([await Campaign.findById(campaign._id)]);
}

let workerStarted = false;
function startAdApprovalWorker() {
  if (workerStarted) return;
  workerStarted = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      // The lease recovers jobs after a process restart; the heartbeat protects long media uploads.
      await Campaign.updateMany({ deliveryJobState: 'RUNNING', deliveryJobLease: { $lt: now } }, {
        $set: { deliveryJobState: 'QUEUED', nextDeliveryAttemptAt: now },
      });
      const campaign = await Campaign.findOneAndUpdate({ approvalStatus: 'APPROVED', paymentStatus: 'APPROVED',
        refundedAt: null, deliveryJobState: 'QUEUED', nextDeliveryAttemptAt: { $lte: now } },
        { $set: { deliveryJobState: 'RUNNING', deliveryJobLease: new Date(Date.now() + 15 * 60000) } },
        { new: true }).select('+submissionPayload');
      if (!campaign) return;
      const heartbeat = setInterval(() => Campaign.updateOne({ _id: campaign._id, deliveryJobState: 'RUNNING' },
        { $set: { deliveryJobLease: new Date(Date.now() + 15 * 60000) } }).catch(() => {}), 30000);
      try { await deliverCampaign(campaign); }
      catch (error) {
        const detail = error.response?.data?.error;
        const message = detail?.error_user_msg || detail?.message || error.message;
        const retry = retryableIssue({ ...error, message });
        await Campaign.updateOne({ _id: campaign._id }, { $set: {
          status: fundingIssue(message) ? 'WAITING_FOR_FUNDS' : 'DELIVERY_ERROR',
          metaCreateError: message, metaStatusReason: message,
          deliveryJobState: retry ? 'QUEUED' : 'FAILED', nextDeliveryAttemptAt: new Date(Date.now() + 5 * 60000),
        }, $unset: { deliveryJobLease: 1 } });
      } finally { clearInterval(heartbeat); }
    } catch (error) { console.error('[adApproval] worker:', error.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 30000);
  timer.unref?.();
  tick();
}
module.exports = { approveCampaign, rejectCampaign, retryCampaign, deliverCampaign, startAdApprovalWorker, shiftedSchedule, fundingIssue };
