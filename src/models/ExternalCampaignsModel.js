const mongoose = require('mongoose')

const ExternalCampaignsModel = new mongoose.Schema({
    meta_CampaignId:{
        type:String,
        trim:true
    },
    name:String,
    objective:String,
    status:String,
    businessId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"business"
    },
    adTypeId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"advertisementModel"
    }
})
module.exports = mongoose.model('ExternalCampaignsModel',ExternalCampaignsModel)