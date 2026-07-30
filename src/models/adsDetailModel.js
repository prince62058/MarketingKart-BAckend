const mongoose = require('mongoose')
const ObjectId = mongoose.Schema.Types.ObjectId

const adsDetailsModel = new mongoose.Schema({
   businessId:{
       type:ObjectId,
       ref:'business'
    },
    title:String,
    internalCampiagnId:{
        type:ObjectId,
        ref:"internalCampiagnModel"
    },
    transactionId:String,
    dailyBudget:Number,
    remainingBalance:Number,
    totalBudget:Number,
    metaAdsetId:String,
    googleAdsetId:String,
    mainAdId:String,
    lastSchedulerRunTime: Number
},
{timestamps:true})

module.exports = mongoose.model('adsDetailsModel',adsDetailsModel)