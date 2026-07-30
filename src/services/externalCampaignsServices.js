const campaignModel = require('../models/ExternalCampaignsModel')

exports.createCampaign = async(data)=>{
    return await campaignModel.create(data);
}