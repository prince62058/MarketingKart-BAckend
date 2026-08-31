const mongoose = require("mongoose");

/**
 * One in-flight "link my Facebook Page" attempt.
 *
 * The consent happens in the browser, so the app and the callback are two
 * different requests — this is what ties them together, and it holds the token
 * only until the app collects it. Expires on its own so an abandoned attempt
 * never leaves a user token lying around.
 */
const pageLinkStateSchema = new mongoose.Schema({
  state: { type: String, required: true, unique: true, index: true },
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "business",
    required: true,
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", default: null },
  userAccessToken: { type: String, default: null },
  pages: { type: Array, default: [] },
  completedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, expires: 900 },
});

module.exports = mongoose.model("pageLinkState", pageLinkStateSchema);
