const mongoose = require("mongoose");
const advertisementModel = new mongoose.Schema(
  {
    image: { type: String, trim: true },
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    isInstagram: { type: Boolean, trim: true },
    isFacebook: { type: Boolean, trim: true },
    isGoogle: { type: Boolean, trim: true },
    advertisementType: {
      type: String,
      enum: [
        "LEADS",
        "WHATSAPP_MESSAGES",
        "CALLS",
        "WEBSITE_VISITORS",
        "APP_INSTALLS",
        "VIDEO_VIEWS",
        "POST_ENGAGEMENT",
        "PAGE_LIKES",
        "EVENT_RESPONSES",
        "OFFER_CLAIMS",
        "PRODUCT_CATALOG_SALES",
        "STORE_VISITS"
      ],
    },
    minimumBudget: { type: Number, trim: true },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);
module.exports = mongoose.model("advertisementModel", advertisementModel);
