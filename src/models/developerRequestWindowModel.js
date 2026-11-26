const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: String,
  requests: { type:Number, required:true },
  expiresAt: { type:Date, required:true, expires:0 },
});
module.exports = mongoose.model("developerRequestWindow",schema);
