const mongoose = require("mongoose");

const offeringModel = new mongoose.Schema({
  title: String,
  image: String,
  description: String,
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "planModel",
  },
  disable: { type: Boolean, default: false },
});
module.exports = mongoose.model(
  "offeringModel",
  offeringModel
);
