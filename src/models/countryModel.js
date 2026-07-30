const mongoose = require("mongoose");
const countryModel = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: null },
    icon: { type: String, trim: true, default: null },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);
module.exports = mongoose.model("countrymodel", countryModel);
