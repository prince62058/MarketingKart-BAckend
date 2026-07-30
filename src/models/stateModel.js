const mongoose = require("mongoose");
let objectId = mongoose.Types.ObjectId;

const stateModel = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    icon: { type: String, default: null, trim: true },
    countryId: { type: objectId, ref: "countryModel" },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("statemodel", stateModel);
