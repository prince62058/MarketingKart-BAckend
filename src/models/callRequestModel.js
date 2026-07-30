const mongoose = require("mongoose");
const ObjectId = mongoose.Schema.Types.ObjectId;

const callRequestModel = new mongoose.Schema(
  {
    userId: {
      type: ObjectId,
      ref: "userModel",
    },
    status: {
      type: String,
      enum: ["Pending", "Completed", "No Response", "Busy", "Scheduled", "Converted", "Call me Later"],
      default: "Pending",
    },
    assignedStaff: {
      type: ObjectId,
      ref: "Staff",
      default: null,
    },
    isAssigned: {
      type: Boolean,
      default: false,
    },
    followUps: [
      {
        scheduledTime: {
          type: String,
        },
        notes: String,
      },
    ],
    statusUpdatedAt: { type: Date, default: null },
    statusUpdatedBy: { type: ObjectId, ref: 'userModel', default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CallRequest", callRequestModel);
