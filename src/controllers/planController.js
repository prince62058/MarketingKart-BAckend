const planService = require("../services/planService");
const planModel = require("../models/planModel");
const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const responseBuilder = require("../utils/responseBuilder");
const offeringsModel = require("../models/offeringsModel");
const advertisementModel = require("../models/advertisementModel");
const mongoose = require("mongoose");

const refuse = (res, message) =>
  res.status(statusCodes["Bad Request"]).json(responseBuilder(apiResponseStatusCode[400], message));

// Checks what the admin form sent. With `partial` only the fields present are checked (an edit).
// Resolves to an error message, or null when the input is fine.
async function planInputProblem(body, { partial }) {
  const has = key => body[key] !== undefined && body[key] !== null && body[key] !== "";
  if (!partial || has("title")) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return "Give the package a name.";
    if (title.length > 80) return "The package name can be up to 80 characters.";
  }
  if (!partial || has("price")) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0 || price > 10000000) return "Enter the total price in rupees (more than 0).";
  }
  if (!partial || has("duretion")) {
    const days = Number(body.duretion);
    if (!Number.isInteger(days) || days < 1 || days > 365) return "Duration must be a whole number of days from 1 to 365.";
  }
  if (has("aiImageCount")) {
    const count = Number(body.aiImageCount);
    if (!Number.isInteger(count) || count < 0 || count > 100) return "AI images must be a whole number from 0 to 100.";
  }
  if (!partial || has("advertisementTypeId")) {
    const id = String(body.advertisementTypeId || "");
    if (!/^[0-9a-f]{24}$/i.test(id) || !mongoose.isValidObjectId(id)) return "Choose which ad objective this package is for.";
    if (!(await advertisementModel.exists({ _id: id }))) return "That ad objective does not exist.";
  }
  return null;
}
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
  const problem = await planInputProblem(req.body || {}, { partial: false });
  if (problem) return refuse(res, problem);
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

  const numPrice = Number(price) || 0;
  const numDuration = Number(duretion) || 1;
  const computedDaily = dailySpendBudget || Math.round(numPrice / numDuration);
  const computedInsta = instaBudget !== undefined && instaBudget !== null ? Number(instaBudget) : Math.round(computedDaily / 2);
  const computedFb = facebookBudget !== undefined && facebookBudget !== null ? Number(facebookBudget) : Math.round(computedDaily / 2);

  const createData = await planService.createPlan({
    advertisementTypeId,
    title,
    price: numPrice,
    duretion: numDuration,
    dailySpendBudget: computedDaily,
    aiImageCount: aiImageCount !== undefined ? Number(aiImageCount) : 5,
    instaBudget: computedInsta,
    googleBudget: googleBudget || null,
    facebookBudget: computedFb,
    views: views ? String(views) : "N/A",
    reach: reach ? String(reach) : "N/A",
    leads: leads ? String(leads) : "N/A",
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
  const problem = await planInputProblem(req.body || {}, { partial: true });
  if (problem) return refuse(res, problem);
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
  // No packages yet (or all deleted) is a normal answer: the admin page and the app both show an empty list.
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

exports.deletePlan = async (req, res) => {
  const planId = req.plan?._id || req.params.planId;
  const deleted = await planService.deletePlan(planId);
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.DELETED,
        deleted
      )
    );
};
