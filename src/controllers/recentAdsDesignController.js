const recentAdsDesignModel = require("../models/recentAdsDesignByLeadkarModel")
const { deleteFileFromObjectStorage } = require("../middlewares/multer");


// create ads
exports.createAds = async(req,res)=>{
    const img = req?.file ? req.file.location : null;
    // const {img} = req.body;
    const data =  await recentAdsDesignModel.create({img});
    res.status(201).json({
        success:true,
        message:"Ads created successfully",
        data:data
    })
}

// get ads
exports.getAds = async(req,res)=>{
    const {adsId} = req.query;
    const data =  await recentAdsDesignModel.findById(adsId);

    res.status(200).json({
        success:true,
        message:"Ads fetched successfully",
        data:data
    })
}

// ads updated
exports.updateAds = async(req,res)=>{
    const {adsId} = req.query;
    const img = req?.file ? req.file.location : null;
    const adsData = await recentAdsDesignModel.findById(adsId);
    if(!adsData){
        return res.status(404).json({
            success:false,
            message:"Ads not Found"
        })
    }

    const data =  await recentAdsDesignModel.findOneAndUpdate({_id:adsId}, {img:img} , {new:true});
    if (req.file != null) {
        deleteFileFromObjectStorage(adsData.img);
      }
    res.status(201).json({
        success:true,
        message:"Ads updated successfully",
        data:data
    })
}


// ads deleted
exports.deleteAds = async(req,res)=>{
    const {adsId} = req.query;
    const adsData = await recentAdsDesignModel.findById(adsId);
    if(!adsData){
        return res.status(404).json({
            success:false,
            message:"Ads not Found"
        })
    }

    const data =  await recentAdsDesignModel.findOneAndDelete({_id:adsId});

    return res.status(200).json({
        success:false,
        message:"Ads deleted successfully",
    })
}

// get all ads
exports.getAllAds = async(req,res)=>{
    const {page =1, limit =20, sort=-1, disable} = req.query;
    const skip = (page-1) * limit;
    const filter = {
        ...(disable && {disable})
    }
    const data = await recentAdsDesignModel.find(filter).sort({createdAt:parseInt(sort)}).skip(skip).limit(limit);
    const total = await recentAdsDesignModel.countDocuments(filter);
    res.status(200).json({
        success:true,
        message:"All Ads fetched successfully",
        data:data,
        currentPage:page,
        page: Math.ceil(total/limit)
    })
}