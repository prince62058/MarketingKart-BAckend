const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required:true, index:true },
  reference: { type:String, required:true },
  amountPaise: { type:Number, required:true },
  issuedBy: { type:mongoose.Schema.Types.ObjectId, required:true },
  status: { type:String, enum:["open","paid"], default:"open" },
  providerId: String,
  checkoutUrl: String,
  paidAt: Date,
}, {timestamps:true});
schema.index({userId:1,reference:1},{unique:true});
module.exports = mongoose.model("developerInvoice",schema);
