// One Razorpay payment pays for exactly one thing. Every consumer (wallet credit, subscription...)
// records the payment here first; a second claim of the same payment or order fails, whoever
// makes it and whatever it is for. Orders created by /createOrder also carry the buyer's id.
const mongoose = require("mongoose");

const claimSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true },
    orderId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "userModel", required: true },
    purpose: { type: String, required: true },
  },
  { timestamps: true }
);
const Claim = mongoose.models.razorpayPaymentClaim || mongoose.model("razorpayPaymentClaim", claimSchema);
// Create the collection up front: a claim is written inside wallet transactions, where MongoDB
// cannot create a new collection.
// Creating it while a transaction is open makes that transaction fail ("catalog changed"), so it
// is made once on connect, and callers make sure of it before they start their transaction.
let ready = null;
function ensureCollection() {
  if (!ready) {
    // The unique indexes are what stop a second claim, and building them is a catalog change too.
    ready = Claim.createCollection().catch(() => { /* exists already */ }).then(() => Claim.init()).then(() => true);
    ready.catch(() => { ready = null; });
  }
  return ready;
}
if (mongoose.connection.readyState === 1) ensureCollection();
else mongoose.connection.once("connected", () => { ensureCollection(); });

function fail(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Throws when the order was created for someone else (orders made before this carry no owner). */
function assertOrderOwner(order, userId) {
  const owner = order?.notes?.userId;
  if (owner && String(owner) !== String(userId)) throw fail("This payment belongs to another account");
}

async function claimPayment({ paymentId, orderId, userId, purpose }, session) {
  try {
    await Claim.create([{ paymentId: String(paymentId), orderId: String(orderId), userId, purpose }], session ? { session } : undefined);
  } catch (error) {
    if (error?.code === 11000) throw fail("This Razorpay payment has already been used");
    throw error;
  }
}

module.exports = { Claim, claimPayment, assertOrderOwner, ensureCollection };
