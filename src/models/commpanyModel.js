const mongoose = require("mongoose");

const commpanyModel = new mongoose.Schema(
  {
    supportContact: String,
    whatsappContact: String,
    email: String,
    companyName: String,
    banner: [String],
    logo: String,
    guideVideo: [
      { type: mongoose.Schema.Types.ObjectId, ref: "videoModel" },
    ],
    website: String,
  },
  { timestamps: true }
);
module.exports = mongoose.model("commpanyModel", commpanyModel);