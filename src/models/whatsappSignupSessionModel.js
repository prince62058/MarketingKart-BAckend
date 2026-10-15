const mongoose = require('mongoose');
module.exports = mongoose.model('WhatsAppSignupSession', new mongoose.Schema({
  stateHash: {type:String,required:true,unique:true},
  userId: {type:mongoose.Schema.Types.ObjectId,required:true,index:true},
  mode: {type:String,enum:['NEW_OR_MIGRATE','BUSINESS_APP'],default:'NEW_OR_MIGRATE'},
  status: {type:String,enum:['WAITING','PROCESSING','CONNECTED','FAILED'],default:'WAITING'},
  message: String,
  expiresAt: {type:Date,required:true,expires:0},
}, {timestamps:true}));
