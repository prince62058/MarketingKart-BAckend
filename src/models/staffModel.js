const mongoose = require("mongoose");
const objectId = mongoose.Schema.Types.ObjectId;

const staffSchema = new mongoose.Schema(
  {
    userId: {
      type: objectId,
      ref: "userModel",
      required: true,
      unique: true
    },
    businesses: [{
      type: objectId,
      ref: "business",
      required: true
    }],
    role: {
      type: String,
      enum: ["STAFF", "BDE", "MANAGER", "ADMIN"],
      default: "BDE",
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    permissions: [{
      type: String,
    }],
  },
  { timestamps: true }
);

// Index for faster querying
staffSchema.index({ userId: 1, isActive: 1 });
staffSchema.index({ businesses: 1, isActive: 1 });

module.exports = mongoose.model("Staff", staffSchema);
