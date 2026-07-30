const mongoose = require("mongoose");

const permissionModel = new mongoose.Schema(
  {
    name: {
      type: String,
      enum: [
        "ManageBusiness",
        "FaceBookPage",
        "RunAds",
        "AdsView",
        "LeadManagement",
        "WalletManagement",
        "UsersRolls&Permissions",
        "InvoiceManagemnt",
      ],
    },
    permisstion: [
      {
        type: String,
        enum: ["CREATE", "UPDATE", "DELETE", "GETLIST", "GET","LINK","UNLINK"],
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserpermissionModel", permissionModel);
