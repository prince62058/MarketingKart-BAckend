const mongoose = require("mongoose");

const homepageSchema = new mongoose.Schema({
  image: [
    {
      image: {
        type: String,
        trim: true,
      },
      icon: {
        type: String,
        trim: true,
      },
      Title: {
        type: String,
        trim: true,
      },
    },
  ],
  banner: {
    type: String,
    trim: true,
  },
  title: {
    type: String,
    trim: true,
  },
  subTitle: {
    type: String,
    trim: true,
  },
  contactNumber: {
    type: Number,
    trim: true,
  },
});

const Homepage = mongoose.model("Homepage", homepageSchema);

module.exports = Homepage;
