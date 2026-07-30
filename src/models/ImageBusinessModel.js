const mongoose = require("mongoose");
let objectId = mongoose.Types.ObjectId;
const businessImageModel = new mongoose.Schema(
  {
    image: String,
    imageType: { type: String, enum: ["ADMIN_UPLOADS", "AI", "BUSINESS_EDIT"] },
    businessId: { type: objectId, ref: "business" },
    aiImageId: { type: objectId, ref: "" },
    businessCategoryId: [{ type: objectId, ref: "" }],
    servicesId: [{ type: objectId, ref: "" }],
    imageCategoryId: { type: objectId, ref: "imageCategorymodel" },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);
module.exports = mongoose.model("businessImageModel", businessImageModel);
