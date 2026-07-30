const mongoose = require('mongoose')

const aiImageModel = mongoose.Schema({
    title:{
        type:String,
        default:null
    },
    price:{
        type:Number,
        default:null
    },
    validity:{
        type:Number,
        default:null
    },
    aiImageCount:{
        type:Number,
        default:null
    }
})

module.exports = mongoose.model("aiImageModel",aiImageModel)