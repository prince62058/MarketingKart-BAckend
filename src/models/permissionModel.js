const mongoose = require('mongoose')

const permissionModel = new mongoose.Schema({
    roleName:String,
    permissions:[],
    businessId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'business'
    },
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'userModel'
    },
    accessLevel:{
                type:String,
                enum:['ADMIN','EMPLOYEE']
            },
           
},
{timestamps:true}
)

module.exports = mongoose.model('permissionModel',permissionModel)