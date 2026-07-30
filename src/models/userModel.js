const mongoose = require("mongoose");
const objectId = mongoose.Schema.Types.ObjectId;

const userModel = mongoose.Schema(
  {
    name: { type: String, default: null, trim: true },
    mobile: { type: Number, default: null, trim: true },
    image: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true },
    fcm:{ type: String, default: null, trim: true },
    userType: {
      type: String,
      enum: ["USER", "ADMIN", "SUBUSER"],
      default: "USER",
      trim: true,
    },
     otp2:String,
	  callRequest: {
      type: Boolean,
      default: false,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
      trim: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
      trim: true,
    },
    password: { type: String, default: null, trim: true },
    otp: { type: String, default: null, trim: true },
    userRole: {
      type: objectId,
      ref: "UserRole",
      default: null,
    },
    permisstion:[],
    userId:{
      type: objectId,
      ref: "userModel",
      default: null,
    },
    role: {
      type: Number,
      default: 0,
      enum: [0, 1, 2],
    },
    businessId: [{
      type: objectId,
      ref: "business",
      default: null,
    }],
    disable: {
      type: Boolean,
      default: false,
    },
	adminFcm: {
  type: [String],   // ✅ Array of strings
},
    wallet: {
      type: Number,
      default: 0,
    },
    whatsappWallet: {
      type: Number,
      default: 0,
    },
	uninstalled: {
      type: Boolean,
      default: false,
    }
},
  { timestamps: true }
);

userModel.index({ createdAt: -1 });
userModel.index({ userType: 1 });

module.exports = mongoose.model("userModel", userModel);
