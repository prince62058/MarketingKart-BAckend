const videoModel = require("../models/videoModel");
const commpanyModel = require("../models/commpanyModel");
const {deleteFileFromObjectStorage} = require('../middlewares/multer')
exports.createVideo = async (req, res) => {
  try {
    const title = req.body?.title || null;
    const videoUrl = req.files?.videoUrl?.[0]?.key || req.body?.url || null;
    const thumbnail = req.files?.thumbnail?.[0]?.key || req.body?.thumbnail || null;
    let data = await videoModel.create({
      title,
      videoUrl,
      thumbnail,
    });
    return res
      .status(200)
      .send({
        success: true,
        message: "video created successfully",
        data: data,
      });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.getAllVideos = async (req, res) => {
  try {
    const data = await videoModel.find().sort({ createdAt: -1 });
    return res
      .status(200)
      .send({ success: true, message: "videos fetched successfully", data });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.updateVideo = async (req, res) => {
  try {
    const { videoId } = req.query;
    if (!videoId) {
      return res.status(400).send({ success: false, message: "please provide valid videoId" });
    }
    const update = {};
    if (req.body?.title !== undefined) update.title = req.body.title;
    if (req.body?.url !== undefined) update.videoUrl = req.body.url;
    if (req.body?.thumbnail !== undefined) update.thumbnail = req.body.thumbnail;

    const data = await videoModel.findByIdAndUpdate(videoId, update, { new: true });
    if (!data) {
      return res.status(400).send({ success: false, message: "please provide valid videoId" });
    }
    return res
      .status(200)
      .send({ success: true, message: "video updated successfully", data });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.deleteVideo = async (req, res) => {
  try {
    const { videoId } = req.query;
    let data = await videoModel.findOneAndDelete({ _id: videoId });
    if(!data){
        return res.status(400).send({success:false,message:"please provide valid videoId"})
    }
    if(data){
      await  deleteFileFromObjectStorage(data?.videoUrl)
      await  deleteFileFromObjectStorage(data?.thumbnail)
    }

    let companyData = await commpanyModel.findOne().select("guideVideo");
    if(companyData){
    let guideVideo = companyData?.guideVideo;
    if(guideVideo?.length>0){
    const index = guideVideo.indexOf(videoId);
    if (index > -1) {
      // only splice guideVideo when item is found
      guideVideo.splice(index, 1); // 2nd parameter means remove one item only
    }
}
    await commpanyModel.findOneAndUpdate(
        {_id:companyData._id},
        {
            $set:{
                guideVideo:guideVideo
            }
        }
    )
    }

    return res
      .status(200)
      .send({ success: true, message: "video deleted successfully",data:data });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};
