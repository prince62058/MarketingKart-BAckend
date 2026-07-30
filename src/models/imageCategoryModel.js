const mongoose = require("mongoose");
const imageCategoryModel = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);
module.exports = mongoose.model("imageCategorymodel", imageCategoryModel);
