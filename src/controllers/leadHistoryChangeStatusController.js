const {
  statusCodes,
  defaultResponseMessage,
  apiResponseStatusCode,
} = require("../Message/defaultMessage");
const leadHistoryChangeService = require("../services/leadHistoryChangeService");
const responseBuilder = require("../utils/responseBuilder");
const leadHistoryChangeModel = require("../models/leadHistoryChangeStatusModel");
const pinnedLeadsModel = require('../models/pinnedLeadsModel');
const permissionModel = require("../models/permissionModel");


exports.getAllLeadHistoryByLeadId = async (req, res) => {
  const { page = 1, leadId,specificUserId } = req.query;
  const skip = (page - 1) * 20;
  let obj = {}
  if(leadId){
    obj.leadId = leadId
  }
  // console.log(leadId)
  if(specificUserId){
    obj.userId = specificUserId
  }
  // console.log("yaha tk",leadId)
  const getAll = await leadHistoryChangeService.getAllLeadHistoryByLeadId(
    obj,
    skip
  );
  const totalCount = (
    await leadHistoryChangeService.getAllLeadHistoryByLeadId(obj)
  ).length;
  const pageCount = Math.ceil(totalCount / 20);
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        getAll,
        pageCount
      )
    );
};

exports.updateLeadHistory = async (req, res) => {
  const { leadId } = req.query;
  const { statusChange, actionType } = req.body;
  const updateData = await leadHistoryChangeModel.create({
    leadId: leadId,
    historyType: statusChange != undefined ? "STATUSCHANGE" : "ACTIONTYPE",
    statusChange,
    actionType,
    userId: req.user._id,
  });
  return res
    .status(200)
    .send({ success: true, message: "update successfully", data: updateData });
};

exports.createLeadHistoryWithTransferAndRevolked = async (req, res) => {
  const { leadId=[], transferId,assignLead } = req.body;
  // Every lead must belong to a business the caller can act on, and the person it is pinned to
  // must be that business's owner or one of its team members.
  const mongoose = require("mongoose");
  const { canAccessBusiness } = require("../helpers/businessAccess");
  const leadModel = require("../models/leadModel");
  const businessModel = require("../models/businessModel");
  const userModel = require("../models/userModel");
  const caller = req.authUser || req.user;
  const ids = Array.isArray(leadId) ? leadId : [];
  if (!mongoose.isValidObjectId(transferId) || ids.length > 500 || ids.some((id) => !mongoose.isValidObjectId(id))) {
    return res.status(400).json({ success: false, message: "Invalid lead or user" });
  }
  const target = await userModel.findById(transferId).select("_id businessId").lean();
  if (!target) return res.status(404).json({ success: false, message: "Not found" });
  for (const id of ids) {
    const lead = await leadModel.findById(id).select("businessId").lean();
    const businessId = lead?.businessId;
    if (!businessId || !(await canAccessBusiness(caller, businessId))) return res.status(404).json({ success: false, message: "Not found" });
    const targetBelongs = (target.businessId || []).some((b) => String(b) === String(businessId))
      || Boolean(await businessModel.exists({ _id: businessId, userId: target._id }));
    if (!targetBelongs) return res.status(403).json({ success: false, message: "That person is not part of this business" });
  }
  for(let i=0;i<leadId.length;i++){
  if(!assignLead){
    await pinnedLeadsModel.findOneAndDelete({userId:transferId,leadId:leadId[i]})
  }
  if(assignLead){
    let check = await pinnedLeadsModel.findOne({userId:transferId,leadId:leadId[i]})
    console.log(check)
    if(!check){

    await pinnedLeadsModel.create({
      userId:transferId,
      leadId:leadId[i]
    })
     await leadHistoryChangeModel.create({
      leadId: leadId[i],
      transferId: transferId,
      historyType: assignLead?'TRANSFER':'REVOKED',
      userId: req.user._id,
    });
  }
  }
}
  
  

  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
      )
    );
};

exports.listOfLeadAssignUser = async (req, res) => {
  const { leadId,page } = req.query;
  const skip = page ? page - 1 * 20 : 0;
 let data = await pinnedLeadsModel.find({leadId:leadId}).populate('userId','name image mobile').skip(skip).limit(20)
 const length = await pinnedLeadsModel.countDocuments({leadId:leadId});
 const pageCount = Math.ceil(length / 20);

  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        data,
        pageCount
      )
    );
};
