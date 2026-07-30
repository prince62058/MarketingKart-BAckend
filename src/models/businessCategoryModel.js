const mongoose = require("mongoose");

const businessCategory = new mongoose.Schema({
  title: { type: String, default: null, trim: true },
  icon: { type: String, default: null, trim: true },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "businessCategory",
    default: null,
    trim: true,
  },
 orderNumber:Number,
  disable: {
    type: Boolean,
    default: false,
  },
},{timestamps:true});
module.exports = mongoose.model("businessCategory", businessCategory);