
const mongoose = require("mongoose");

const webhook = new mongoose.Schema({
 leadgenId:String
});

module.exports = mongoose.model("webhook", webhook);
