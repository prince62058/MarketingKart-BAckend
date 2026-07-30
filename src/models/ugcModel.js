const mongoose = require("mongoose");

const ugcSchema = new mongoose.Schema(
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

module.exports = mongoose.model("ugcModel", ugcSchema);