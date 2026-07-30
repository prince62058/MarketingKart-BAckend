const mongoose = require("mongoose");

const GstBusinessSchema = new mongoose.Schema(
  {
    gstNumber: { type: String },
    gstRegisteredName: { type: String },
    address: { type: String },
    city: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "citymodel",
    },
    state: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "statemodel",
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("GstBusiness", GstBusinessSchema);
