const mongoose = require("mongoose");

const managerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "Senior Marketing Manager", trim: true },
    specialty: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Manager", managerSchema);
