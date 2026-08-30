const mongoose = require("mongoose");
const { normalizeMobileNumber } = require("../utils/mobileValidetionHandler");
const objectId = mongoose.Schema.Types.ObjectId;

// Every write path (login, sub-user, staff, admin panel, imports) funnels its
// mobile through this setter, so the stored value is always the same canonical
// 10-digit number. Without it "+919876543210", "09876543210" and 9876543210
// become three separate accounts for one person.
// Setters do NOT run on query filters in Mongoose 6 — callers must still pass
// normalizeMobileNumber(...) when building a lookup.
const setMobile = (value) => {
  const normalized = normalizeMobileNumber(value);
  // Unparseable input is passed through untouched so Mongoose's own cast error
  // still surfaces instead of being silently swallowed into null.
  return normalized === null ? value : normalized;
};

const userModel = mongoose.Schema(
  {
    name: { type: String, default: null, trim: true },
    mobile: { type: Number, default: null, trim: true, set: setMobile },
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
    },
    // Set by scripts/repairDuplicateMobileAccounts.js when this account was a
    // duplicate of another one for the same phone number. Its mobile is cleared
    // so the surviving account owns the number; nothing else is deleted.
    mergedInto: {
      type: objectId,
      ref: "userModel",
      default: null,
    }
},
  { timestamps: true }
);

userModel.index({ createdAt: -1 });
userModel.index({ userType: 1 });

// One account per phone number, enforced by the database so a race between two
// concurrent "send OTP" calls can never create a duplicate login.
// Partial filter: admin/email-only accounts keep mobile === null and are exempt.
userModel.index(
  { mobile: 1 },
  {
    unique: true,
    partialFilterExpression: { mobile: { $type: "number" } },
    name: "mobile_unique_when_set",
  },
);

module.exports = mongoose.model("userModel", userModel);
