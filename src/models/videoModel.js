const mongoose = require('mongoose')

const videoModel = new mongoose.Schema({
    title:{type:String, default:null},
    videoUrl:String,
    thumbnail:String,
},
{new:true, timestamps:true}
)

module.exports = mongoose.model('videoModel',videoModel)