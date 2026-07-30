const {
  apiResponseStatusCode,
  defaultResponseMessage,
  statusCodes,
} = require("../Message/defaultMessage");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");
const commpanyModel = require("../models/commpanyModel");
const responseBuilder = require("../utils/responseBuilder");

exports.createOrUpdateCompany = async (req, res) => {
  const {
    supportContact,
    whatsappContact,
    email,
    companyName,
    website,
    commpanyId,
    bannerIndex,
    guideVideo,
  } = req.body;
  let data;
  const check = await commpanyModel.findOne();
  console.log(check, "dhhd");
  if (check) {
    console.log("SKLSSKSKS");
    // let check = await commpanyModel.findOne({ _id: commpanyId });
    let banner = [];
    let logo = null;
    // console.log("asdfg",req.files.logo)
    req.files ? req.files.logo?.map((eml) => (logo = eml.location)) : null;
    banner = req.files ? req.files?.banner?.map((eml) => (banner = eml?.location)) : [];
    // console.log("banner",req.files?.banner)
    if (logo != null && check?.logo) {
      deleteFileFromObjectStorage(check?.logo);
    }
    // console.log('banner',banner)
    if (
      req.files &&
      req.files.banner &&
      check?.banner.length != 0 &&
      bannerIndex
    ) {
      // console.log("enter")
      check.banner.splice(bannerIndex, 1);
    }
    if (req.files && req.files.banner && check?.banner.length != 0) {
      check?.banner.concat(banner);
    }
    if (guideVideo.length != 0) {
      check?.guideVideo.concat(guideVideo);
    }
    data = await commpanyModel.findByIdAndUpdate(
      { _id: check?._id },
      {
        $set: {
          guideVideo: check?.guideVideo,
          logo: logo,
          banner: banner.length?banner:check.banner,
          supportContact: supportContact,
          whatsappContact: whatsappContact,
          email: email,
          companyName: companyName,
          website: website,
        },
      },
      { new: true }
    );
  } else {
    console.log("DKDLKDLKD", req.files);
    let banner = [];
    let logo = null;
    req.files ? req.files.logo?.map((eml) => (logo = eml.location)) : null;
    req.files ? req.files?.banner?.map((eml) => banner?.push(eml?.location)) : [];
    data = await commpanyModel.create({
      guideVideo: guideVideo,
      logo: logo,
      banner: banner,
      supportContact: supportContact,
      whatsappContact: whatsappContact,
      email: email,
      companyName: companyName,
      website: website,
    });
  }
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        "Company Update And Create Successfully..",
        data
      )
    );
};

exports.getCompany = async (req, res) => {
  const company = await commpanyModel.findOne().populate("guideVideo");

  if (!company) {
    res
      .status(statusCodes["Not Found"])
      .json(
        responseBuilder(
          apiResponseStatusCode[404],
          defaultResponseMessage.NOT_FOUND
        )
      );
  }

  // Respond with the company details
  res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage.FETCHED,
        company
      )
    );
};
