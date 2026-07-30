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
  console.log(leadId)
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
