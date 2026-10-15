const mongoose = require('mongoose');
// A phone belongs to one SaaS tenant, including while onboarding is in progress.
module.exports = mongoose.model('WhatsAppPhoneClaim', new mongoose.Schema({
  _id: {type:String,required:true},
  userId: {type:mongoose.Schema.Types.ObjectId,required:true},
  registrationPinEncrypted: {type:String,select:false},
}, {timestamps:true,toJSON:{transform:(_doc,ret)=>{delete ret.registrationPinEncrypted;return ret;}},toObject:{transform:(_doc,ret)=>{delete ret.registrationPinEncrypted;return ret;}}}));
