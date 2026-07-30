const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema({
  title: { type: String, trim: true },
  url:   { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model("VideoYoutube", videoSchema);