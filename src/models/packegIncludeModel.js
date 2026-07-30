const mongoose = require("mongoose");

const packageModel = new mongoose.Schema({
  title: String,
  image: String,
  description: String,
});
module.exports = mongoose.model(
  "packageModel",
  packageModel
);
