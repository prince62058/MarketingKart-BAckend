const mongoose = require("mongoose");

const voiceOverVideoSchema = new mongoose.Schema(
  {
    thumbnail:{
        type:String,
        trim:true
    },
    video:{
        type:String,
        trim:true
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("voiceOverVideoModel", voiceOverVideoSchema);