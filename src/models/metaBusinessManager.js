const mongoose=require('mongoose')
const metaBusinessManagerModel = new mongoose.Schema({
    metaBusinessManagerId:String,
    MetaUserId:String,
    leadkartBusinessId:String,
})

module.exports = mongoose.model('metaBusinessManagerModel',metaBusinessManagerModel)


