const mongoose = require("mongoose");

const teamMemberSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "business",
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "userModel",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ["Admin", "Editor", "Viewer"],
      default: "Editor",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TeamMember", teamMemberSchema);
