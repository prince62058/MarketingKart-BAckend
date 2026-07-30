const mongoose = require('mongoose')
const pinnedLeadsModel = new mongoose.Schema({
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'userModel',
    },
    leadId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'leadModel'
    }
},
{
    timestamps:true
})

module.exports = mongoose.model("pinnedLeadsModel",pinnedLeadsModel)
