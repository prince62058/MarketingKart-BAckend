const mongoose = require("mongoose");

const contactUsSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
  },
  message: {
    type: String,
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "userModel",
  },
});

const ContactUs = mongoose.model("ContactUs", contactUsSchema);

module.exports = ContactUs;
