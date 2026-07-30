const mongoose = require('mongoose')

const videoModel = new mongoose.Schema({
    videoUrl:String,
    thumbnail:String,
},
{new:true}
)

module.exports = mongoose.model('videoModel',videoModel)