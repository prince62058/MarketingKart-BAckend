const planService = require("../services/planService");
const planModel = require("../models/planModel");
const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const offeringsModel = require("../models/offeringsModel");
//  Create
exports.getAdvertisementTypeIdByPlan = async (req, res) => {
    // Step 1: Find all plans based on advertisementTypeId
    const plans = await planService.getAllPlan({
      advertisementTypeId: req.query.advertisementTypeId,
    })

    // const findAllWithKeys = plans.map((eml) => ({
    //   ...eml._doc,
    //   views: null,
    //   reach: null,
    //   leads: null,
    // }));
    // consol
    // Step 2: Iterate through each plan to find offerings associated with it

    // const plansWithOfferings = await Promise.all(
    //   plans.map(async (plan) => {
    //     const offerings = await offeringsModel.find({ planId: plan._id });
    //     let totalLeads = 0
    //     let totalReach = 0
    //     if (plan?.advertisementTypeId?.advertisementType == "OUTCOME_LEADS") {
    //       let reach = Number(plan?.instaBudget) * 6.5 + Number(plan?.facebookBudget) * 8;
    //       let leads = Number(plan?.instaBudget) * 0.0135 + Number(plan?.facebookBudget) * 0.014;
    //       totalLeads = Math.ceil(leads)
    //       totalReach = Math.ceil(reach)

    //     }
    //     else if (plan?.advertisementTypeId?.advertisementType == "OUTCOME_TRAFFIC") {
    //       let reach = Number(plan?.instaBudget) * 8 + Number(plan?.facebookBudget) * 8;
    //       let leads = Number(plan?.instaBudget) * 0.0185 + Number(plan?.facebookBudget) * 0.0215;
    //       totalLeads = Math.ceil(leads)
    //       totalReach = Math.ceil(reach)
    //     }
    //     else if (plan?.advertisementTypeId?.advertisementType == "OUTCOME_SALES") {
    //       let reach = Number(plan?.instaBudget) * 9 + Number(plan?.facebookBudget) * 9;
    //       let leads = Number(plan?.instaBudget) * 0.0225 + Number(plan?.facebookBudget) * 0.0315;
    //       totalLeads = Math.ceil(leads)
    //       totalReach = Math.ceil(reach)
    //     }
    //     else if (plan?.advertisementTypeId?.advertisementType == "OUTCOME_AWARENESS") {
    //       let reach = Number(plan?.instaBudget) * 13 + Number(plan?.facebookBudget) * 12.9;
    //       let leads = Number(plan?.instaBudget) * 0.775 + Number(plan?.facebookBudget) * 0.865;
    //       totalLeads = Math.ceil(leads)
    //       totalReach = Math.ceil(reach)
    //     }
    //     else if (plan?.advertisementTypeId?.advertisementType == "OUTCOME_ENGAGEMENT") {
    //       let reach = Number(plan?.instaBudget) * 7.7 + Number(plan?.facebookBudget) * 8.4;
    //       let leads = Number(plan?.instaBudget) * 0.029 + Number(plan?.facebookBudget) * 0.04;
    //       totalLeads = Math.ceil(leads)
    //       totalReach = Math.ceil(reach)
    //     }
    //     else if (plan?.advertisementTypeId?.advertisementType == "APP_INSTALLS") {
    //       let reach = Number(plan?.instaBudget) * 7.7 + Number(plan?.facebookBudget) * 8.4;
    //       let leads = Number(plan?.instaBudget) * 0.029 + Number(plan?.facebookBudget) * 0.04;
    //       totalLeads = Math.ceil(leads)
    //       totalReach = Math.ceil(reach)
    //     }
    //     return {
    //       ...plan._doc,
    //       views: null,
    //       reach: totalReach,
    //       leads: totalLeads,
    //       offerings: offerings,
    //     };
    //   })
    // );

    // Step 3: Return the response
    return res.status(statusCodes.OK).json({
      statusCode: apiResponseStatusCode[200],
      message: defaultResponseMessage.FETCHED,
      data: plans,
    });

};

exports.createPlan = async (req, res) => {
  const {
    advertisementTypeId,
    title,
    price,
    duretion,
    dailySpendBudget,
    aiImageCount,
    instaBudget,
    googleBudget,
    facebookBudget,
    views,
    reach,
    leads,
  } = req.body;
  const createData = await planService.createPlan({
    advertisementTypeId,
    title,
    price,
    duretion,
    dailySpendBudget,
    aiImageCount,
    instaBudget,
    googleBudget,
    facebookBudget,
    views,
    reach,
    leads,
  });
  res
    .status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage.CREATED,
        createData
      )
    );
};

//  update

exports.updatePlan = async (req, res) => {
  const planData = req.plan;
  const {
    advertisementTypeId,
    title,
    price,
    duretion,
    dailySpendBudget,
    aiImageCount,
    instaBudget,
    googleBudget,
    facebookBudget,
    views,
    reach,
    leads,
  } = req.body;
  const updateData = await planService.updatePlan(planData?._id, {
    advertisementTypeId,
    title,
    price,
    duretion,
    dailySpendBudget,
    aiImageCount,
    instaBudget,
    googleBudget,
    facebookBudget,
    views,
    reach,
    leads,
  });
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.UPDATED,
        updateData
      )
    );
};

//  getAll

exports.getAllPlan = async (req, res) => {
  const { page = 1 ,search,disable} = req.query;
  const skip = (page - 1) * 20;
  let query = {}
  if(search){
    query.title = new RegExp(search, "i");
  }
  if(disable){
    query.disable = disable
  }
  const findAll = await planService.getAllPlan(query,skip);
  const totalCount = await planModel.countDocuments(query)
  const pageCount = Math.ceil(totalCount / 20);
  // const findAllWithKeys = findAll.map((eml) => ({
  //   ...eml._doc,
  //   views: null,
  //   reach: null,
  //   leads: null,
  // }));
  if (!findAll.length) {
    res
      .status(statusCodes["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage.NOT_FOUND,
          findAll
        )
      );
  } else {
    res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage.FETCHED,
          findAll,
          pageCount
        )
      );
  }
};

//  getSingle

exports.getSinglePlan = async (req, res) => {
  let offering = await offeringsModel.find({ planId: req.plan?._id });
  req.plan._doc.offering = offering;
  req.plan._doc.views = null;
  req.plan._doc.reach = null;
  req.plan._doc.leads = null;
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        req.plan
      )
    );
};
//  disable

exports.disablePlan = async (req, res) => {
  const updateDisable = await planService.disablePlan(req.plan);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        updateDisable.disable
          ? defaultResponseMessage.DISABLED
          : defaultResponseMessage.ENABLED,
        updateDisable
      )
    );
};
