const internalCampaignModel = require('../models/internalCampiagnModel')

exports.getAllIntenalCampiagnByBusinessId = async (query,skip) => {
    return await internalCampaignModel
      .find(query)
      .populate('addTypeId','title')
      .select(
        "image title status mainAdId metaAdId facebookAdSetId createdAt totalBudget dailyBudget startDate endDate isInstaAdEnabled isFacebookAdEnabled thambnail videoId adtype spendAmount totalSpendBudget totalReach totalImpression totalClicks totalLeads totalFirstReplies metaCreateError location mobileNumber AddAmountInsights",
      )
      .sort({createdAt:-1})
      .skip(skip)
      .limit(20)
      .exec();
  };