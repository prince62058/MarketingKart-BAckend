const videoModel = require("../models/videoModel");
const commpanyModel = require("../models/commpanyModel");
const {deleteFileFromObjectStorage} = require('../middlewares/multer')
exports.createVideo = async (req, res) => {
  try {
    let videoUrl = req.files ? req.files.videoUrl[0].key : null;
    let thumbnail = req.files ? req.files.thumbnail[0].key : null;
    let data = await videoModel.create({
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
