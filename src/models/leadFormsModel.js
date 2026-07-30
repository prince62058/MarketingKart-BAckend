const mongoose = require('mongoose')
const ObjectId = mongoose.Schema.Types.ObjectId

const leadFormModel = new mongoose.Schema({
    fromName:String,
    formId:String,
    adTypeId:{
        type:ObjectId,
        ref:'advertisementModel'
    },
    pageId:String,
    businessId:{
        type:ObjectId,
        ref:"business"
    },
    internalCampiagnId:{
        type:ObjectId,
        ref:"internalCampiagnModel"
    },
    isNameAvailble:Boolean,
    isEmailAvailable:Boolean,
    isUserWhatsappNumberAvailable:Boolean,
    isUserContactNumberAvailable:Boolean,
    islastSchedulerRunTime : String
},{ timestamps: true })

module.exports = mongoose.model('leadFormModel',leadFormModel)