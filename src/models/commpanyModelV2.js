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
  playStoreUrl: { type: String, default: "https://play.google.com/store/apps/details?id=com.marketingkart.app" },
  homeBannerImages: { type: [String], default: [] },
  // Dynamic Invoice Template Customization
  invoicePrefix: { type: String, trim: true, default: "MKAI" },
  invoiceTagline: { type: String, trim: true, default: "Smart Marketing Stronger Business with AI" },
  invoiceThankYouText: { type: String, trim: true, default: "Thank You! for choosing MarketingKart.ai" },
  invoiceBankName: { type: String, trim: true, default: "HDFC Bank" },
  invoiceAccountName: { type: String, trim: true, default: "Ayotrix Infotech Pvt Ltd" },
  invoiceAccountNumber: { type: String, trim: true, default: "502000XXXXXXXX" },
  invoiceIfscCode: { type: String, trim: true, default: "HDFC0001234" },
  invoiceUpiId: { type: String, trim: true, default: "ayotrix@hdfcbank" },
  invoiceNotes: { 
    type: String, 
    trim: true, 
    default: "Please make the payment within the due date.\nThis is a computer generated invoice and does not require a physical signature.\nFor any queries, feel free to contact us." 
  },
  invoiceAuthorizedSignatory: { type: String, trim: true, default: "Ayotrix Infotech Pvt Ltd" },
  invoiceBrandParent: { type: String, trim: true, default: "Ayotrix Infotech Pvt Ltd" },
  invoiceBrandSubtext: { type: String, trim: true, default: "IDEAS | TECHNOLOGY | GROWTH" },
  invoiceBrandCity: { type: String, trim: true, default: "Indore, Madhya Pradesh, India" },
});

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
