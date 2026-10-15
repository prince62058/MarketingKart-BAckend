const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: String, wabaId: String, field: String, value: mongoose.Schema.Types.Mixed,
  status: {type:String,default:'PENDING'}, availableAt: {type:Date,default:Date.now},
  attempts: {type:Number,default:0}, error: String, completedAt: Date,
}, {timestamps:true});
schema.index({status:1,availableAt:1});
schema.index({completedAt:1},{expireAfterSeconds:7*86400});
module.exports=mongoose.model('whatsappCoexistenceEvent',schema);
