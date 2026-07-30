const mongoose = require('mongoose')
const ObjectId = mongoose.Schema.Types.ObjectId
const leadHistoryChangeModel = new mongoose.Schema({
 leadId:{
    type:ObjectId,
    ref:"leadModel"
 },
 userId:{
   type:ObjectId,
   ref:'userModel'
 },
 transferId:{
   type:ObjectId,
   ref:'userModel'
 },
 historyType:{
    type:String,
    enum:['STATUSCHANGE','ACTIONTYPE','TRANSFER','REVOKED']
 },
 statusChange:{
    type:String,
    enum:["NEW","INTERESTED","NOT_INTERESTED","CONVERTED","LOST","VISITED","NOT_ANSWERED","IN_PROGRESS",'UNQUALIFIED','NOT_CONNECTED'],
    default:'NEW'
 },
 actionType:{
    type:String,
    enum:['NOT_ADDED','OFFER_SENT','WHATSAAP_FOLLOWUP','CALL_FOLLOWUP','FOLLOW_UP_DATE_SET','LEAD_CONTACT_CHANGES','SMS_SENT'],
    default:'NOT_ADDED'
 },
 
},
{timestamps:true}
)

module.exports = mongoose.model('leadHistoryChangeModel',leadHistoryChangeModel)