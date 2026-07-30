const adsDetailModel = require('../models/adsDetailModel')

exports.createAdsDetails = async(data)=>{
    return await adsDetailModel.create(data);
}