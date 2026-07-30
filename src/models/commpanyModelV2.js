const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  address: {
    type: String,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
  },
  serviceFee: {
    type: Number,
    default: 20,
  },
  paymentGetWayFee: {
    type: Number,
  },
  gstFee:{
    type: Number,
  },
  website: {
    type: String,
    trim: true,
  },
  favicon: {
    type: String,
    trim: true,
  },
  logo: {
    type: String,
    trim: true,
  },
  returnPolicy: {
    type: String,
    trim: true,
  },
  termsAndConditions: {
    type: String,
    trim: true,
  },
  privacyPolicy: {
    type: String,
    trim: true,
  },
	 isUnderMaintenance: { type: Boolean, default: false },
  minimumAppVersion: { type: String, default: "1.0.0" },
  minimumVersionCode: { type: Number, default: 1 },
  latestAppVersion: { type: String, default: "1.0.0" },
  latestVersionCode: { type: Number, default: 1 },
  forceUpdateEnabled: { type: Boolean, default: false },
  playStoreUrl: { type: String, default: "https://play.google.com/store/apps/details?id=com.leadkart.ai" },
  homeBannerImages: { type: [String], default: [] },
  homeBannerUrl: { type: String, trim: true, default: null },
});

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
