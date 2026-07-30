const mongoose = require("mongoose");

const faqmodel = new mongoose.Schema(
  {
    question:String,
    answer:String,
    type:{
      type:String,
      enum:['ALL','ADD_PLAN','AI_IMAGE','AD_REPORT'],
      default:"ALL"
    },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);
module.exports = mongoose.model("faqmodel", faqmodel);
