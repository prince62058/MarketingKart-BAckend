const mongoose = require("mongoose");

const orderHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["UGC", "VOICE", "SIMPLE", "IMAGE"] },
    orderdDetail: {},
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "CANCELLED", "INPROCESS", "START"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OrderHistory", orderHistorySchema);
