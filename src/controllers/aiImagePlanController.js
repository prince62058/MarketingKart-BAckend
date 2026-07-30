const {
    statusCodes,
    defaultResponseMessage,
    apiResponseStatusCode,
  } = require("../Message/defaultMessage");
  const { deleteFileFromObjectStorage } = require("../middlewares/multer");
  const aiImageService = require("../services/aiImageService");
  const responseBuilder = require("../utils/responseBuilder");

  exports.createAiImage = async(req,res)=>{
    const {title,price,validity,aiImageCount} = req.body
    const createData = await aiImageService.createAiImagePlan({
      title:title,
      price:price,
      validity:validity,
      aiImageCount:aiImageCount
    })
    return res.status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage?.CREATED,
        createData
      )
    )
  }

  

  exports.getAllAiImagePlan = async (req, res) => {
    const {page=1} = req.query
    const skip = (page - 1) * 20;
    let obj={}
    const getAll = await aiImageService.getAllAiImagePlan(obj,skip);
    const totalCount = (await aiImageService.getAllAiImagePlan(obj)).length;
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