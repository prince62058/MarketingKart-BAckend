// models/AdErrorLog.js
const mongoose = require('mongoose');

const adErrorLogSchema = new mongoose.Schema({
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'business',
    required: true,
  },
  internalCampaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'internalCampiagnModel',
  },
  metaCampaignId: {
    type: String,
  },
  metaAdSetId: {
    type: String,
  },
  errorType: {
    type: String,
    enum: ['CAMPAIGN_CREATION', 'ADSET_CREATION', 'AD_CREATION', 'CREATIVE_UPLOAD', 'LEAD_FORM',"GENERAL"],
    required: true,
  },
  errorMessage: {
    type: String,
    required: true,
  },
  errorDetails: {
    type: Object,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('AdErrorLog', adErrorLogSchema);