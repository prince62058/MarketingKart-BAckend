const mongoose = require("mongoose");

const recentAdsDesignSchema = new mongoose.Schema(
  {
    img:{
        type:String,
        trim:true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("RecentAdsDesignModel", recentAdsDesignSchema);