const mongoose = require("mongoose");
let objectId = mongoose.Types.ObjectId;
const cityModel = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    stateId: { type: objectId, ref: "statemodel", trim: true },
    countryId: { type: objectId, ref: "countryModel", trim: true },
    icon: { type: String, trim: true },
    cityLat: { type: String, trim: true },
    cityLong: { type: String, trim: true },
    disable: { type: Boolean, default: false },
  },
  { timestamps: true }
);
module.exports = mongoose.model("citymodel", cityModel);
