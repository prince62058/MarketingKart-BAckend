const internalCampaignModel = require('../models/internalCampiagnModel')

exports.getAllIntenalCampiagnByBusinessId = async (query,skip) => {
    return await internalCampaignModel
      .find(query)
      .populate('addTypeId','title')
      // The Meta campaign id is what live insights are read against when an ad
      // id was never persisted, so it has to travel with the list.
      .populate('externalCampiagnId','meta_CampaignId')
      .select(
        "image title status mainAdId metaAdId facebookAdSetId instaAdSetId externalCampiagnId createdAt totalBudget dailyBudget startDate endDate isInstaAdEnabled isFacebookAdEnabled thambnail videoId adtype spendAmount totalSpendBudget totalReach totalImpression totalClicks totalLeads totalFirstReplies metaCreateError metaEffectiveStatus metaStatusReason metaStatusSyncedAt location mobileNumber AddAmountInsights",
      )
      .sort({createdAt:-1})
      .skip(skip)
      .limit(20)
      .exec();
  };