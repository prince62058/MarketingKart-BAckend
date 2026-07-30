const leadHistoryChangeModel = require('../models/leadHistoryChangeStatusModel')
const adsDetailsModel = require('../models/adsDetailModel')
exports.getAllLeadHistoryByLeadId = async (query, skip) => {
    console.log(query)
    let data =  await leadHistoryChangeModel.find(query).populate('leadId','adId').skip(skip).limit(20).exec();
    console.log(data)
    for(let i=0;i<data.length;i++){
        let adsDetailData = await adsDetailsModel.findOne({mainAdId:data[i]?.leadId?.adId}).populate('internalCampiagnId','title image createdAt')
        data[i]._doc.title = adsDetailData?.internalCampiagnId
        ?.title
        data[i]._doc.image = adsDetailData?.internalCampiagnId
        ?.image
        data[i]._doc.createdAt = adsDetailData?.internalCampiagnId
        ?.createdAt
    }
    return data
};