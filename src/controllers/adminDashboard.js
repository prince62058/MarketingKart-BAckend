const userModel = require("../models/userModel");
const internalCampiagnModel = require("../models/internalCampiagnModel");
const businessModel = require("../models/businessModel");
const leadModel = require("../models/leadModel");
const AdErrorLog = require("../models/AdErrorLog");

const transtionModel = require("../models/transtionModel");
const crypto = require("crypto");
const axios = require("axios");
const {
  syncCampaignStatuses,
  applyStatusToDocs,
} = require("../helpers/metaStatusHelper");

// Create the appsecret_proof
exports.permanentToken = (req, res) => {
  try {
    const { accessToken, appSecret } = req.query;
    const appsecretProof = crypto
      .createHmac("sha256", appSecret)
      .update(accessToken)
      .digest("hex");

    // console.log("appsecret_proof:", appsecretProof);
    return res.status(200).send({
      success: true,
      message: "generate token successfully",
      data: appsecretProof,
    });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.DashBoardApiAdmin = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);

    const statuses = [
      "ACTIVE", "PAUSED", "DELETED", "ARCHIVED",
      "IN_REVIEW", "IN_PROGRESS", "COMPLETED", "SCHEDULED",
    ];

    // Parallelize independent counts and aggregations
    const [
      basicCounts,
      statusWiseAdsAgg,
      adTypeWiseAgg,
      revenueAgg,
      todayRevenueAgg,
      monthRevenueAgg,
      lastMonthRevenueAgg,
      todayCounts
    ] = await Promise.all([
      // 1. Basic total counts
      Promise.all([
        userModel.countDocuments(),
        internalCampiagnModel.countDocuments(),
        transtionModel.countDocuments({ type: "CREDIT" }),
        internalCampiagnModel.countDocuments({ planId: { $ne: null } }),
        businessModel.countDocuments({ disable: false }),
        leadModel.countDocuments()
      ]),

      // 2. Status wise ads count using aggregation
      internalCampiagnModel.aggregate([
        { $match: { status: { $in: statuses } } },
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]),

      // 3. Ad Type wise status count using aggregation
      internalCampiagnModel.aggregate([
        {
          $group: {
            _id: { addTypeId: "$addTypeId", status: "$status" },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: "$_id.addTypeId",
            statuses: {
              $push: { k: "$_id.status", v: "$count" }
            },
            total: { $sum: "$count" }
          }
        }
      ]),

      // 4. Total Payment Received
      transtionModel.aggregate([
        { $match: { type: "CREDIT" } },
        { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } }
      ]),

      // 5. Today's Revenue
      transtionModel.aggregate([
        { $match: { type: "CREDIT", createdAt: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } }
      ]),

      // 6. This Month's Revenue
      transtionModel.aggregate([
        { $match: { type: "CREDIT", createdAt: { $gte: monthStart, $lt: monthEnd } } },
        { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } }
      ]),

      // 7. Last Month's Revenue
      transtionModel.aggregate([
        { $match: { type: "CREDIT", createdAt: { $gte: lastMonthStart, $lt: lastMonthEnd } } },
        { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } }
      ]),

      // 8. Today's counts
      Promise.all([
        transtionModel.countDocuments({ createdAt: { $gte: today, $lt: tomorrow } }),
        businessModel.countDocuments({ createdAt: { $gte: today, $lt: tomorrow } }),
        userModel.countDocuments({ createdAt: { $gte: today, $lt: tomorrow } }),
        internalCampiagnModel.countDocuments({ status: "ACTIVE", startDate: { $gte: today, $lt: tomorrow } }),
        internalCampiagnModel.countDocuments({ status: "COMPLETED", endDate: { $gte: today, $lt: tomorrow } })
      ])
    ]);

    // Process Status Wise Ads
    let statusWiseAds = {};
    statuses.forEach(s => statusWiseAds[s] = 0);
    statusWiseAdsAgg.forEach(item => statusWiseAds[item._id] = item.count);
    statusWiseAds["TOTAL"] = basicCounts[1];

    // Process Ad Type Wise Ads
    let adsTypeStatusWise = {};
    const adTypeIds = adTypeWiseAgg.map(a => a._id).filter(Boolean);
    const adTypeTitles = {};
    if (adTypeIds.length) {
      const addTypeDocs = await require("../models/advertisementModel").find({ _id: { $in: adTypeIds } }).select("title").lean();
      addTypeDocs.forEach(doc => adTypeTitles[doc._id.toString()] = doc.title);
    }

    adTypeWiseAgg.forEach(typeAgg => {
      if (!typeAgg._id) return;
      let typeObj = {};
      statuses.forEach(s => typeObj[s] = 0);
      typeAgg.statuses.forEach(s => typeObj[s.k] = s.v);
      typeObj["TOTAL"] = typeAgg.total;
      adsTypeStatusWise[adTypeTitles[typeAgg._id.toString()] || typeAgg._id] = typeObj;
    });

    const totalRevenue = revenueAgg[0]?.total || 0;

    return res.status(200).send({
      success: true,
      message: "dashboard data fetched",
      userCount: basicCounts[0],
      statusWiseAds: statusWiseAds,
      adsTypeStatusWise: adsTypeStatusWise,
      successfullTransactionCount: basicCounts[2],
      purchasedPackageCount: basicCounts[3],
      totalPaymentReceived: totalRevenue,
      operationalRevenue: totalRevenue,
      businessCount: basicCounts[4],
      leadGennerateCount: basicCounts[5],
      todayTransactionCount: todayCounts[0],
      todayRevenue: todayRevenueAgg[0]?.total || 0,
      todayBusinessCount: todayCounts[1],
      todayUserCount: todayCounts[2],
      totalRevenue: totalRevenue,
      thisMonthRevenue: monthRevenueAgg[0]?.total || 0,
      lastMonthRevenue: lastMonthRevenueAgg[0]?.total || 0,
      todayAdsRunCount: todayCounts[3],
      todayAdsCompleteCount: todayCounts[4],
    });
  } catch (error) {
    console.error("DashBoardApiAdmin Error:", error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.dashBoardGraphsAndCharts = async (req, res) => {
  try {
    let { year } = req.query;
    year = Number(year) || new Date().getFullYear();

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    // Aggregation helper for counts grouped by month
    const getMonthlyCounts = (model, matchQuery = {}) => {
      return model.aggregate([
        { 
          $match: { 
            ...matchQuery, 
            createdAt: { $gte: yearStart, $lt: yearEnd } 
          } 
        },
        {
          $group: {
            _id: { $month: "$createdAt" },
            count: { $sum: 1 }
          }
        }
      ]);
    };

    // Aggregation helper for sums grouped by month
    const getMonthlySums = (model, matchQuery = {}, sumField = "amount") => {
      return model.aggregate([
        { 
          $match: { 
            ...matchQuery, 
            createdAt: { $gte: yearStart, $lt: yearEnd } 
          } 
        },
        {
          $group: {
            _id: { $month: "$createdAt" },
            total: { $sum: { $toDouble: `$${sumField}` } }
          }
        }
      ]);
    };

    // Run all aggregations in parallel
    const [
      adsMonthly,
      usersMonthly,
      businessesMonthly,
      leadsMonthly,
      transactionsMonthly,
      revenueMonthly,
      adTypeMonthly,
      adTypes
    ] = await Promise.all([
      getMonthlyCounts(internalCampiagnModel),
      getMonthlyCounts(userModel),
      getMonthlyCounts(businessModel),
      getMonthlyCounts(leadModel),
      getMonthlyCounts(transtionModel),
      getMonthlySums(transtionModel, { type: "CREDIT" }),
      internalCampiagnModel.aggregate([
        { $match: { createdAt: { $gte: yearStart, $lt: yearEnd } } },
        {
          $group: {
            _id: { month: { $month: "$createdAt" }, addTypeId: "$addTypeId" },
            count: { $sum: 1 }
          }
        }
      ]),
      require("../models/advertisementModel").find().select("_id title").lean()
    ]);

    // Formatters
    const formatMonthly = (data, isSum = false) => {
      const arr = Array(12).fill(0);
      data.forEach(item => {
        if (item._id >= 1 && item._id <= 12) {
          arr[item._id - 1] = isSum ? item.total : item.count;
        }
      });
      return arr;
    };

    const adsCountArr = formatMonthly(adsMonthly);
    const userCountArr = formatMonthly(usersMonthly);
    const businessCountArr = formatMonthly(businessesMonthly);
    const leadCountArr = formatMonthly(leadsMonthly);
    const transactionCountArr = formatMonthly(transactionsMonthly);
    const revenueArr = formatMonthly(revenueMonthly, true);

    // Process Ad Type Wise Monthly Data
    const adTypeTitles = {};
    adTypes.forEach(t => adTypeTitles[t._id.toString()] = t.title);

    const adsTypeWiseArr = {};
    adTypes.forEach(t => adsTypeWiseArr[t.title] = Array(12).fill(0));

    adTypeMonthly.forEach(item => {
      const typeTitle = adTypeTitles[item._id.addTypeId?.toString()];
      if (typeTitle && item._id.month >= 1 && item._id.month <= 12) {
        adsTypeWiseArr[typeTitle][item._id.month - 1] = item.count;
      }
    });

    return res.status(200).send({
      success: true,
      message: "All graph data fetched",
      months,
      adsCountArr,
      userCountArr,
      businessCountArr,
      leadCountArr,
      revenueArr,
      transactionCountArr,
      adsTypeWiseArr,
    });

  } catch (error) {
    console.error("dashBoardGraphsAndCharts Error:", error);
    return res.status(500).send({ success: false, message: error.message });
  }
};



exports.userListForAdmin = async (req, res) => {
  try {
    const { userType, search, sort, page = 1, limit = 20, disable } = req.query;
    let query = {};

    // Filter by userType if provided
    if (userType) {
      query.userType = userType;
    }
    if (disable) {
      query.disable = disable;
    }

    // Add search criteria
    if (search) {
      const isNumeric = !isNaN(search);
      query.$or = isNumeric
        ? [{ mobile: Number(search) }]
        : [{ email: new RegExp(search, "i") }];
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Fetch the user list with pagination
    let userList = await userModel
      .find(query)
      .sort({ createdAt: -1 })
      .select("name mobile email disable")
      .skip(skip)
      .limit(Number(limit));

    // Only proceed with ad count calculation if sorting by ads is required
    if (sort === "byAds") {
      const userIds = userList.map((user) => user._id);

      // Fetch business data and ad counts for the users in one go
      const businessData = await businessModel
        .find({ userId: { $in: userIds } })
        .select("_id userId");

      // Count ads for each business
      const adCounts = await internalCampiagnModel.aggregate([
        {
          $match: {
            businessId: { $in: businessData.map((business) => business._id) },
          },
        },
        { $group: { _id: "$businessId", count: { $sum: 1 } } },
      ]);

      // Map businessId to ad count
      const adCountMap = adCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {});

      // Map userId to total ad count
      const userAdCountMap = businessData.reduce((acc, business) => {
        const adCount = adCountMap[business._id] || 0;
        acc[business.userId] = (acc[business.userId] || 0) + adCount;
        return acc;
      }, {});

      // Attach totalAdCount to each user and sort by this count
      userList = userList
        .map((user) => ({
          ...user._doc,
          totalAdCount: userAdCountMap[user._id] || 0,
        }))
        .sort((a, b) => b.totalAdCount - a.totalAdCount);
    }

    const count = await userModel.countDocuments(query);
    const pageCount = Math.ceil(count / limit);

    return res.status(200).send({
      success: true,
      message: "User list fetched",
      data: userList,
      page: pageCount,
    });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.adListForAdmin = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search, addTypeId } = req.query;
    let query = {};

    if (status) query.status = status;
    if (addTypeId) query.addTypeId = addTypeId;
    if (search) query.title = new RegExp(search, "i");

    const skip = (page - 1) * limit;

    // Sort ACTIVE ads first, then by createdAt descending
    let data = await internalCampiagnModel
      .find(query)
      // Performance columns come from here — without them the admin Ads list
      // could only ever show 0 leads and 0 reach for every campaign.
      .select(
        // metaCreateError carries Meta's own words for why an ad never got
        // built. It was written on every failure and then selected nowhere, so
        // DELIVERY_ERROR reached the admin as a bare red badge.
        "status addTypeId businessId title pageName fromName caption destinationUrl targetArea image thambnail createdAt instaBudget facebookBudget totalBudget dailyBudget mainAdId spendAmount totalLeads totalFirstReplies totalReach totalImpression totalClicks metaCreateError metaStatusReason",
      )
      .populate("addTypeId", "title")
      .populate({
        path: "businessId",
        select: "businessName userId",
        populate: { path: "userId", select: "name email mobile phone" },
      })
      .sort({ 
        status: 1,  // ACTIVE comes first alphabetically
        createdAt: -1 
      })
      .skip(skip)
      .limit(Number(limit));

    // Custom sort: ACTIVE first, then IN_PROGRESS/IN_REVIEW, then rest
    const statusPriority = {
      'ACTIVE': 0,
      'IN_PROGRESS': 1,
      'IN_REVIEW': 1,
      'PREPARING': 1,
      'PAUSED': 2,
      'COMPLETED': 3,
      // Rejected sorts with the other things needing attention, above completed.
      'REJECTED': 4,
      'DELIVERY_ERROR': 4,
    };

    data = data.sort((a, b) => {
      const pA = statusPriority[a.status] ?? 5;
      const pB = statusPriority[b.status] ?? 5;
      if (pA !== pB) return pA - pB;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // One shared reading of Meta's truth — the same mapping the app's list uses,
    // so admin and advertiser never disagree about whether an ad is live.
    const statusResults = await syncCampaignStatuses(data);
    if (statusResults.size) {
      applyStatusToDocs(data, statusResults);
      data = data.sort((a, b) => {
        const pA = statusPriority[a._doc?.status || a.status] ?? 5;
        const pB = statusPriority[b._doc?.status || b.status] ?? 5;
        if (pA !== pB) return pA - pB;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    }

    const count = await internalCampiagnModel.countDocuments(query);
    const pageCount = Math.ceil(count / 20);

    return res.status(200).send({
      success: true,
      message: "Ad list fetched",
      data: data,
      page: pageCount,
    });
  } catch (err) {
    return res.status(500).send({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Fetch all Meta campaigns for the system ad account that are NOT yet
 * linked to any internal campaign. Used by the "Link Meta Ad" admin modal.
 */
exports.getUnlinkedMetaCampaigns = async (req, res) => {
  try {
    const token = process.env.systemUserAccessToken;
    const adAccountId = process.env.adAccountId || "1066150309285362";

    // 1. Find all mainAdIds / campaignIds already tracked in our DB
    const linked = await internalCampiagnModel.find({}).select("mainAdId campaignId").lean();
    const linkedIds = new Set(
      linked.flatMap(c => [c.mainAdId, c.campaignId]).filter(Boolean).map(String),
    );

    // 2. Fetch all campaigns from Meta
    const cRes = await axios.get(`https://graph.facebook.com/v21.0/act_${adAccountId}/campaigns`, {
      params: {
        access_token: token,
        fields: "id,name,status,effective_status,objective,created_time,daily_budget,lifetime_budget",
        limit: 50,
      },
    });

    // 3. Fetch all ads (to get images)
    const adsRes = await axios.get(`https://graph.facebook.com/v21.0/act_${adAccountId}/ads`, {
      params: {
        access_token: token,
        fields: "id,name,campaign_id,status,effective_status,creative{image_url,thumbnail_url,title,body}",
        limit: 50,
      },
    });
    const adsByCampaign = {};
    (adsRes.data?.data || []).forEach(ad => {
      if (!adsByCampaign[ad.campaign_id]) adsByCampaign[ad.campaign_id] = [];
      adsByCampaign[ad.campaign_id].push(ad);
    });

    // 4. Filter out already-linked campaigns and attach ads
    const unlinked = (cRes.data?.data || [])
      .filter(c => !linkedIds.has(c.id))
      .map(c => {
        const ads = adsByCampaign[c.id] || [];
        const primaryAd = ads[0];
        const budget = c.lifetime_budget
          ? parseInt(c.lifetime_budget) / 100
          : c.daily_budget ? parseInt(c.daily_budget) / 100 : 0;
        return {
          metaCampaignId: c.id,
          metaAdId: primaryAd?.id || null,
          name: c.name,
          status: c.effective_status || c.status,
          objective: c.objective,
          budget,
          createdAt: c.created_time,
          image: primaryAd?.creative?.image_url || primaryAd?.creative?.thumbnail_url || null,
          title: primaryAd?.creative?.title || c.name,
          body: primaryAd?.creative?.body || "",
        };
      });

    return res.status(200).json({ success: true, data: unlinked });
  } catch (err) {
    console.error("getUnlinkedMetaCampaigns error:", err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.response?.data?.error?.message || err.message });
  }
};

/**
 * Link a Meta Campaign / Ad ID to an internal campaign record.
 * Body: { metaCampaignId, metaAdId, businessPhone?, businessName?, pageName? }
 */
exports.linkMetaAdToCampaign = async (req, res) => {
  try {
    const { metaCampaignId, metaAdId, businessPhone, businessName, pageName } = req.body;

    if (!metaCampaignId && !metaAdId) {
      return res.status(400).json({ success: false, message: "metaCampaignId or metaAdId is required" });
    }

    const token = process.env.systemUserAccessToken;

    // 1. Resolve business (optional)
    let bizDoc = null;
    if (businessPhone) {
      const mobile = businessPhone.replace(/\D/g, "");
      bizDoc = await businessModel.findOne({ mobile: { $regex: mobile.slice(-10) } }).lean();
    }
    if (!bizDoc && businessName) {
      bizDoc = await businessModel.findOne({ businessName: { $regex: businessName, $options: "i" } }).lean();
    }

    // 2. Fetch campaign info from Meta
    let campaignInfo = { name: businessName || "Linked Campaign", status: "PAUSED", daily_budget: "0", lifetime_budget: "0" };
    try {
      if (metaCampaignId) {
        const cRes = await axios.get(`https://graph.facebook.com/v21.0/${metaCampaignId}`, {
          params: { access_token: token, fields: "name,status,effective_status,daily_budget,lifetime_budget,created_time,objective" },
        });
        campaignInfo = { ...campaignInfo, ...cRes.data };
      }
    } catch (e) { /* keep default */ }

    // 3. Fetch ad info
    let adInfo = {};
    try {
      if (metaAdId) {
        const aRes = await axios.get(`https://graph.facebook.com/v21.0/${metaAdId}`, {
          params: { access_token: token, fields: "name,status,effective_status,campaign_id,creative{image_url,thumbnail_url,title,body}" },
        });
        adInfo = aRes.data;
      }
    } catch (e) { /* keep default */ }

    // 4. Fetch insights
    let insights = {};
    try {
      const insRes = await axios.get(
        `https://graph.facebook.com/v21.0/${metaCampaignId || metaAdId}/insights`,
        { params: { access_token: token, date_preset: "maximum", fields: "spend,impressions,reach,clicks,actions" } },
      );
      const row = insRes.data?.data?.[0];
      if (row) {
        const actions = row.actions || [];
        const leadAction = actions.find(a =>
          ["lead","leadgen","onsite_conversion.lead","lead_grouped","onsite_web_lead"].includes(a.action_type));
        insights = {
          spendAmount: Math.ceil(parseFloat(row.spend || 0) * 1.18),
          totalReach: parseInt(row.reach || 0, 10),
          totalImpression: parseInt(row.impressions || 0, 10),
          totalClicks: parseInt(row.clicks || 0, 10),
          totalLeads: parseInt(leadAction?.value || 0, 10),
          totalFirstReplies: parseInt(leadAction?.value || 0, 10),
        };
      }
    } catch (e) { /* keep default */ }

    // 5. Map status
    const META_STATUS_MAP = {
      ACTIVE: "ACTIVE", PAUSED: "PAUSED", ADSET_PAUSED: "PAUSED",
      CAMPAIGN_PAUSED: "PAUSED", IN_PROCESS: "IN_REVIEW", PENDING_REVIEW: "IN_REVIEW",
      DISAPPROVED: "REJECTED", WITH_ISSUES: "DELIVERY_ERROR",
    };
    const metaStatus = campaignInfo.effective_status || campaignInfo.status || "PAUSED";
    const status = META_STATUS_MAP[metaStatus] || "PAUSED";

    const budget = campaignInfo.lifetime_budget
      ? parseInt(campaignInfo.lifetime_budget) / 100
      : campaignInfo.daily_budget ? parseInt(campaignInfo.daily_budget) / 100 : 0;

    const imageUrl = adInfo?.creative?.image_url || adInfo?.creative?.thumbnail_url || null;

    const doc = {
      title: campaignInfo.name || businessName || "Linked Campaign",
      fromName: pageName || businessName || campaignInfo.name || "Advertiser",
      pageName: pageName || null,
      totalBudget: budget,
      dailyBudget: budget,
      status,
      mainAdId: metaAdId || null,
      campaignId: metaCampaignId || null,
      image: imageUrl ? [imageUrl] : [],
      thambnail: imageUrl,
      caption: adInfo?.creative?.body || "",
      destinationUrl: "https://marketingkart.ai",
      targetArea: "Pan India",
      metaEffectiveStatus: metaStatus,
      metaStatusSyncedAt: new Date(),
      businessId: bizDoc?._id || null,
      createdAt: campaignInfo.created_time ? new Date(campaignInfo.created_time) : new Date(),
      ...insights,
    };

    // Prevent duplicate linking
    const orConditions = [];
    if (metaAdId) orConditions.push({ mainAdId: metaAdId });
    if (metaCampaignId) orConditions.push({ campaignId: metaCampaignId });

    const existing = await internalCampiagnModel.findOne({ $or: orConditions });
    if (existing) {
      Object.assign(existing, doc);
      await existing.save();
      return res.status(200).json({ success: true, message: "Campaign already linked – data refreshed", data: existing });
    }

    const newCampaign = await internalCampiagnModel.create(doc);
    return res.status(201).json({ success: true, message: "Meta campaign linked successfully", data: newCampaign });
  } catch (err) {
    console.error("linkMetaAdToCampaign error:", err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.response?.data?.error?.message || err.message });
  }
};



exports.adbyIdForAdmin = async (req, res) => {
  try {
    const { addId } = req.query;
    const data = await internalCampiagnModel
      .findById(addId)
      .populate("addTypeId", "title")
      .populate("businessId", "businessName");

    if (!data) {
      return res.status(404).send({
        success: false,
        message: "Ad not found",
      });
    }

    // Initialize metrics
    let totalReach = 0;
    let totalSpendBudget = 0;
    let totalImpression = 0;
    let totalBudget = 0;
    let totalClicks = 0;
    let totalFirstReplies = 0;

    // Get leads count
    let totalLeads = await leadModel.countDocuments({
      internalCampiagnId: data._id,
    });

    // Fetch insights if mainAdId exists
    if (data.mainAdId && process.env.systemUserAccessToken) {
      const url = `https://graph.facebook.com/v22.0/${data.mainAdId}/insights?date_preset=maximum&access_token=${process.env.systemUserAccessToken}&fields=reach,impressions,clicks,spend,actions`;
      try {
        const { data: response } = await axios.get(url);
        const insight = response?.data?.[0];
        if (insight) {
          totalReach = parseInt(insight.reach || 0, 10);
          totalSpendBudget = Math.ceil(parseFloat(insight.spend || 0) * 1.18); // 18% GST
          totalImpression = parseInt(insight.impressions || 0, 10);
          totalClicks = parseInt(insight.clicks || 0, 10);

          const actions = insight.actions || [];
          const firstReplyAction = actions.find(
            (action) =>
              action.action_type === "onsite_conversion.messaging_first_reply" ||
              action.action_type === "click_to_call_call_confirm"
          );
          totalFirstReplies = parseInt(firstReplyAction?.value || 0, 10);
        }
      } catch (insightErr) {
        // Ignore insight errors, just don't attach insights
      }
    }

    // Parse AddAmountInsights if provided (expects JSON string)
    let addAmount = data?.AddAmountInsights;


    // Attach insights to response, adding AddAmountInsights values if present
    data._doc.insights = {
      totalReach: totalReach + (addAmount?.totalReach || 0),
      totalSpendBudget: totalSpendBudget + (addAmount?.totalSpendBudget || 0),
      totalImpression: totalImpression + (addAmount?.totalImpression || 0),
      totalBudget: (addAmount?.totalBudget || 0),
      totalClicks: totalClicks + (addAmount?.totalClicks || 0),
      totalLeads: Math.max(totalLeads, totalFirstReplies) + (addAmount?.totalLeads || 0),
      totalFirstReplies: Math.max(totalLeads, totalFirstReplies) + (addAmount?.totalFirstReplies || 0),
      totalLeadsFromMeta: totalFirstReplies,
      totalLeadsFromDB: totalLeads,
    };

    return res.status(200).send({
      success: true,
      message: "Ad Details Fetched",
      data,
    });
  } catch (err) {
    return res.status(500).send({
      success: false,
      message: err.message,
    });
  }
};
exports.getAdsWithErrors = async (req, res) => {
  try {
    const { page = 1, limit = 20, errorType, search } = req.query;
    let query = {};

    // Build query for AdErrorLog
    if (errorType) query.errorType = errorType;
    if (search) {
      query.$or = [
        { errorMessage: new RegExp(search, "i") },
        { metaCampaignId: new RegExp(search, "i") },
        { metaAdSetId: new RegExp(search, "i") },
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Find error logs and get distinct internalCampaignIds
    const errorLogs = await AdErrorLog.find(query)
      .select(
        "internalCampaignId errorType errorMessage errorDetails metaCampaignId metaAdSetId createdAt"
      )
      .populate("businessId", "businessName");

    // Extract unique internalCampaignIds from error logs
    const campaignIds = [
      ...new Set(
        errorLogs.map((log) => log.internalCampaignId).filter((id) => id)
      ),
    ];

    // Fetch full ad details only for campaigns with errors
    const ads = await internalCampiagnModel
      .find({ _id: { $in: campaignIds } })
      .populate("addTypeId", "title")
      .populate("businessId", "businessName")
      .populate("externalCampiagnId", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Count total ads with errors for pagination
    const count = await internalCampiagnModel.countDocuments({
      _id: { $in: campaignIds },
    });
    const pageCount = Math.ceil(count / limit);

    // Format response data
    const formattedData = ads.map((ad) => {
      // Find all error logs for this campaign
      const campaignErrors = errorLogs
        .filter(
          (log) =>
            log.internalCampaignId &&
            log.internalCampaignId.toString() === ad._id.toString()
        )
        .map((log) => ({
          errorType: log.errorType,
          errorMessage: log.errorMessage,
          errorDetails: log.errorDetails,
          metaCampaignId: log.metaCampaignId,
          metaAdSetId: log.metaAdSetId,
          createdAt: log.createdAt,
        }));

      // Return full ad data with errors
      return {
        _id: ad._id,
        businessId: ad.businessId?._id,
        businessName: ad.businessId?.businessName,
        metaAdId: ad.metaAdId,
        title: ad.title,
        image: ad.image,
        isCallToActionEnabled: ad.isCallToActionEnabled,
        destinationUrl: ad.destinationUrl,
        audienceId: ad.audienceId,
        interest: ad.interest,
        location: ad.location,
        audienceGender: ad.audienceGender,
        ageRangeFrom: ad.ageRangeFrom,
        ageRangeTo: ad.ageRangeTo,
        days: ad.days,
        facebookBudget: ad.facebookBudget,
        instaBudget: ad.instaBudget,
        googleBudget: ad.googleBudget,
        paymentStatus: ad.paymentStatus,
        startDate: ad.startDate,
        endDate: ad.endDate,
        dayStartTime: ad.dayStartTime,
        dayEndTime: ad.dayEndTime,
        status: ad.status,
        isFacebookAdEnabled: ad.isFacebookAdEnabled,
        isInstaAdEnabled: ad.isInstaAdEnabled,
        isGoogleAdEnabled: ad.isGoogleAdEnabled,
        addType: ad.addTypeId?.title,
        creativeId: ad.creativeId,
        externalCampaignId: ad.externalCampiagnId?._id,
        externalCampaignName: ad.externalCampiagnId?.name,
        imageHashId: ad.imageHashId,
        facebookAdSetId: ad.facebookAdSetId,
        instaAdSetId: ad.instaAdSetId,
        transaction: ad.transactionId,
        createdAt: ad.createdAt,
        updatedAt: ad.updatedAt,
        errors: campaignErrors,
      };
    });

    return res.status(200).send({
      success: true,
      message: "Ads with errors fetched successfully",
      data: formattedData,
      page: pageCount,
      // total: count,
    });
  } catch (err) {
    return res.status(500).send({
      success: false,
      message: "An error occurred while fetching ads with errors",
      error: err.message,
    });
  }
};

exports.checkMetaTokenStatus = async (req, res) => {
  try {
    const token = process.env.admin_access_token;
    if (!token) {
      return res.status(200).send({
        success: true,
        tokenValid: false,
        message: "Meta Access Token is not configured",
      });
    }

    const response = await axios.get(
      `https://graph.facebook.com/v21.0/me?access_token=${token}`
    );

    return res.status(200).send({
      success: true,
      tokenValid: true,
      message: "Meta Access Token is active",
      data: { name: response.data?.name, id: response.data?.id },
    });
  } catch (error) {
    const metaError = error.response?.data?.error;
    const isExpired =
      metaError?.code === 190 ||
      metaError?.message?.includes("expired") ||
      metaError?.message?.includes("Session has expired") ||
      metaError?.error_subcode === 463;

    return res.status(200).send({
      success: true,
      tokenValid: false,
      message: isExpired
        ? "⚠️ Meta Access Token has expired! Please refresh it."
        : `Meta Token Error: ${metaError?.message || error.message}`,
    });
  }
};

exports.refreshMetaToken = async (req, res) => {
  try {
    const clientId = process.env.clientId;
    const clientSecret = process.env.clientSecret;
    const currentToken = process.env.admin_access_token;

    if (!clientId || !clientSecret || !currentToken) {
      return res.status(400).send({
        success: false,
        message: "Missing required env variables: clientId, clientSecret, or admin_access_token",
      });
    }

    const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${currentToken}`;

    const response = await axios.get(url);
    const { access_token, expires_in } = response.data;

    if (!access_token) {
      return res.status(400).send({
        success: false,
        message: "Failed to get new token from Meta",
      });
    }

    // Update .env file
    const path = require("path");
    const fs = require("fs");
    const envPath = path.resolve(__dirname, "../../.env");
    let envContent = fs.readFileSync(envPath, "utf-8");

    // Replace admin_access_token value
    envContent = envContent.replace(
      /^(admin_access_token\s*=\s*).*$/m,
      `$1${access_token}`
    );

    fs.writeFileSync(envPath, envContent, "utf-8");

    // Update in-memory env
    process.env.admin_access_token = access_token;

    const expiryDays = Math.floor((expires_in || 0) / (3600 * 24));

    return res.status(200).send({
      success: true,
      message: `Meta token refreshed successfully! Expires in ${expiryDays} days`,
      data: {
        expiryDays,
        expires_in,
      },
    });
  } catch (error) {
    const metaError = error.response?.data?.error?.message || error.message;
    console.error("[META REFRESH ERROR]", error.response?.data || error);
    return res.status(500).send({
      success: false,
      message: `Token refresh failed: ${metaError}`,
    });
  }
};

exports.updateMetaToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).send({
        success: false,
        message: "Token is required",
      });
    }

    // 1. Validate the new token with Facebook
    const validationResponse = await axios.get(
      `https://graph.facebook.com/v21.0/me?access_token=${token}`
    );

    if (!validationResponse.data?.id) {
      return res.status(400).send({
        success: false,
        message: "Invalid Meta Token. Verification failed.",
      });
    }

    // 2. Exchange for a long-lived token (60 days)
    const clientId = process.env.clientId;
    const clientSecret = process.env.clientSecret;

    const exchangeUrl = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${token}`;
    
    const exchangeResponse = await axios.get(exchangeUrl);
    const longLivedToken = exchangeResponse.data?.access_token;
    const expiresIn = exchangeResponse.data?.expires_in;

    if (!longLivedToken) {
      return res.status(400).send({
        success: false,
        message: "Failed to exchange for a long-lived token. Using the provided token instead.",
      });
    }

    // 3. Update .env file with the long-lived token
    const path = require("path");
    const fs = require("fs");
    const envPath = path.resolve(__dirname, "../../.env");
    let envContent = fs.readFileSync(envPath, "utf-8");

    // Replace admin_access_token value
    envContent = envContent.replace(
      /^(admin_access_token\s*=\s*).*$/m,
      `$1${longLivedToken}`
    );

    fs.writeFileSync(envPath, envContent, "utf-8");

    // 4. Update in-memory env
    process.env.admin_access_token = longLivedToken;

    const expiryDays = Math.floor((expiresIn || 0) / (3600 * 24));

    return res.status(200).send({
      success: true,
      message: `Meta Token updated and extended to 60 days for ${validationResponse.data.name}!`,
      data: { 
        name: validationResponse.data.name, 
        id: validationResponse.data.id,
        expiryDays
      },
    });
  } catch (error) {
    const metaError = error.response?.data?.error?.message || error.message;
    console.error("[META UPDATE ERROR]", error.response?.data || error);
    return res.status(400).send({
      success: false,
      message: `Token update failed: ${metaError}`,
    });
  }
};

// ─── Live Ads Status (Real-time from Meta) ──────────────────────────────────
exports.liveAdsStatus = async (req, res) => {
  try {
    const token = process.env.systemUserAccessToken;

    // Fetch all ads from DB (with Meta-linked ones prioritized)
    const allAds = await internalCampiagnModel
      .find({})
      .select(
        "status addTypeId businessId title pageName image thambnail createdAt " +
        "instaBudget facebookBudget totalBudget mainAdId spendAmount startDate endDate dailyBudget"
      )
      .populate("addTypeId", "title")
      .populate("businessId", "businessName userId")
      .sort({ createdAt: -1 })
      .lean();

    const statusMap = {
      ACTIVE: "ACTIVE",
      PAUSED: "PAUSED",
      DELETED: "COMPLETED",
      ARCHIVED: "COMPLETED",
      IN_PROCESS: "PREPARING",
      WITH_ISSUES: "DELIVERY_ERROR",
      CAMPAIGN_PAUSED: "PAUSED",
      ADSET_PAUSED: "PAUSED",
      PENDING_REVIEW: "IN_REVIEW",
      DISAPPROVED: "DELIVERY_ERROR",
      PREAPPROVED: "PREPARING",
      PENDING_BILLING_INFO: "PREPARING",
    };

    // Fetch live data from Meta for ads that have mainAdId
    const adsWithMeta = allAds.filter((ad) => ad.mainAdId);
    const metaResults = {};

    if (adsWithMeta.length > 0 && token) {
      const results = await Promise.allSettled(
        adsWithMeta.map(async (ad) => {
          try {
            // Fetch status + insights in parallel
            const [statusRes, insightRes] = await Promise.all([
              axios.get(
                `https://graph.facebook.com/v22.0/${ad.mainAdId}?fields=effective_status,name&access_token=${token}`
              ),
              axios
                .get(
                  `https://graph.facebook.com/v22.0/${ad.mainAdId}/insights?date_preset=today&fields=reach,impressions,clicks,spend,actions&access_token=${token}`
                )
                .catch(() => ({ data: { data: [] } })),
            ]);

            const metaStatus = statusRes.data?.effective_status;
            const insight = insightRes.data?.data?.[0] || {};
            const actions = insight.actions || [];
            const leadsAction = actions.find(
              (a) =>
                a.action_type === "onsite_conversion.messaging_first_reply" ||
                a.action_type === "offsite_conversion.fb_pixel_lead" ||
                a.action_type === "click_to_call_call_confirm" ||
                a.action_type === "lead"
            );

            metaResults[ad._id.toString()] = {
              metaStatus: metaStatus || null,
              mappedStatus: statusMap[metaStatus] || null,
              todayMetrics: {
                reach: parseInt(insight.reach || 0, 10),
                impressions: parseInt(insight.impressions || 0, 10),
                clicks: parseInt(insight.clicks || 0, 10),
                spend: parseFloat(insight.spend || 0),
                leads: parseInt(leadsAction?.value || 0, 10),
              },
              lastSyncedAt: new Date().toISOString(),
            };

            // Auto-sync DB status if different
            const mapped = statusMap[metaStatus];
            if (mapped && mapped !== ad.status) {
              await internalCampiagnModel.findByIdAndUpdate(ad._id, {
                $set: { status: mapped },
              });
            }
          } catch (err) {
            // Individual ad fetch failed — skip
          }
        })
      );
    }

    // Build enriched ads list
    const enrichedAds = allAds.map((ad) => {
      const meta = metaResults[ad._id.toString()] || null;
      const liveStatus = meta?.mappedStatus || ad.status;

      return {
        _id: ad._id,
        title: ad.title,
        businessName: ad.businessId?.businessName || "-",
        userId: ad.businessId?.userId || null,
        pageName: ad.pageName || "-",
        adType: ad.addTypeId?.title || "-",
        totalBudget: ad.totalBudget || 0,
        dailyBudget: ad.dailyBudget || 0,
        spendAmount: ad.spendAmount || 0,
        image: ad.thambnail || (ad.image && ad.image[0]) || null,
        startDate: ad.startDate,
        endDate: ad.endDate,
        createdAt: ad.createdAt,
        dbStatus: ad.status,
        liveStatus: liveStatus,
        metaStatus: meta?.metaStatus || null,
        hasMetaId: !!ad.mainAdId,
        todayMetrics: meta?.todayMetrics || {
          reach: 0,
          impressions: 0,
          clicks: 0,
          spend: 0,
          leads: 0,
        },
        lastSyncedAt: meta?.lastSyncedAt || null,
      };
    });

    // Sort: ACTIVE first, then IN_PROGRESS/IN_REVIEW, then rest
    const statusPriority = {
      ACTIVE: 0,
      PREPARING: 1,
      IN_PROGRESS: 1,
      IN_REVIEW: 1,
      SCHEDULED: 2,
      PAUSED: 3,
      COMPLETED: 4,
      DELIVERY_ERROR: 5,
    };

    enrichedAds.sort((a, b) => {
      const pA = statusPriority[a.liveStatus] ?? 6;
      const pB = statusPriority[b.liveStatus] ?? 6;
      if (pA !== pB) return pA - pB;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Build summary
    const summary = {
      ACTIVE: 0,
      PREPARING: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      PAUSED: 0,
      COMPLETED: 0,
      SCHEDULED: 0,
      DELIVERY_ERROR: 0,
      TOTAL: enrichedAds.length,
    };

    enrichedAds.forEach((ad) => {
      if (summary.hasOwnProperty(ad.liveStatus)) {
        summary[ad.liveStatus]++;
      }
    });

    // Today's aggregate metrics for active ads
    const todayTotals = enrichedAds
      .filter((ad) => ad.liveStatus === "ACTIVE")
      .reduce(
        (acc, ad) => {
          acc.reach += ad.todayMetrics.reach;
          acc.impressions += ad.todayMetrics.impressions;
          acc.clicks += ad.todayMetrics.clicks;
          acc.spend += ad.todayMetrics.spend;
          acc.leads += ad.todayMetrics.leads;
          return acc;
        },
        { reach: 0, impressions: 0, clicks: 0, spend: 0, leads: 0 }
      );

    return res.status(200).send({
      success: true,
      message: "Live ads status fetched",
      summary,
      todayTotals,
      ads: enrichedAds,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[liveAdsStatus] Error:", err);
    return res.status(500).send({
      success: false,
      message: err.message,
    });
  }
};

exports.getAdsWithErrorsByid = async (req, res) => {
  try {
    const { adsId } = req.query;

    // Find error logs and get distinct internalCampaignIds
    const errorLogs = await AdErrorLog.find({ internalCampaignId: adsId })
      .select(
        "internalCampaignId errorType errorMessage errorDetails metaCampaignId metaAdSetId createdAt"
      )
      .populate("businessId", "businessName");

    // Extract unique internalCampaignIds from error logs
    const campaignIds = [
      ...new Set(
        errorLogs.map((log) => log.internalCampaignId).filter((id) => id)
      ),
    ];

    // Fetch full ad details only for campaigns with errors
    const ads = await internalCampiagnModel
      .find({ _id: { $in: campaignIds } })
      .populate("addTypeId", "title")
      .populate("businessId", "businessName")
      .populate("externalCampiagnId", "name");

    // Format response data
    const formattedData = ads.map((ad) => {
      // Find all error logs for this campaign
      const campaignErrors = errorLogs
        .filter(
          (log) =>
            log.internalCampaignId &&
            log.internalCampaignId.toString() === ad._id.toString()
        )
        .map((log) => ({
          errorType: log.errorType,
          errorMessage: log.errorMessage,
          errorDetails: log.errorDetails,
          metaCampaignId: log.metaCampaignId,
          metaAdSetId: log.metaAdSetId,
          createdAt: log.createdAt,
        }));

      // Return full ad data with errors
      return {
        _id: ad._id,
        businessId: ad.businessId?._id,
        businessName: ad.businessId?.businessName,
        metaAdId: ad.metaAdId,
        title: ad.title,
        image: ad.image,
        isCallToActionEnabled: ad.isCallToActionEnabled,
        destinationUrl: ad.destinationUrl,
        audienceId: ad.audienceId,
        interest: ad.interest,
        location: ad.location,
        audienceGender: ad.audienceGender,
        ageRangeFrom: ad.ageRangeFrom,
        ageRangeTo: ad.ageRangeTo,
        days: ad.days,
        facebookBudget: ad.facebookBudget,
        instaBudget: ad.instaBudget,
        googleBudget: ad.googleBudget,
        paymentStatus: ad.paymentStatus,
        startDate: ad.startDate,
        endDate: ad.endDate,
        dayStartTime: ad.dayStartTime,
        dayEndTime: ad.dayEndTime,
        status: ad.status,
        isFacebookAdEnabled: ad.isFacebookAdEnabled,
        isInstaAdEnabled: ad.isInstaAdEnabled,
        isGoogleAdEnabled: ad.isGoogleAdEnabled,
        addType: ad.addTypeId?.title,
        creativeId: ad.creativeId,
        externalCampaignId: ad.externalCampiagnId?._id,
        externalCampaignName: ad.externalCampiagnId?.name,
        imageHashId: ad.imageHashId,
        facebookAdSetId: ad.facebookAdSetId,
        instaAdSetId: ad.instaAdSetId,
        transaction: ad.transactionId,
        createdAt: ad.createdAt,
        updatedAt: ad.updatedAt,
        errors: campaignErrors,
      };
    });

    return res.status(200).send({
      success: true,
      message: "Ads with errors fetched successfully",
      data: formattedData[0],

      // total: count,
    });
  } catch (err) {
    return res.status(500).send({
      success: false,
      message: err.message,
    });
  }
};
