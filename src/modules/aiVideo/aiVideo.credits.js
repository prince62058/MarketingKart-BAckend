const Studio = require("./aiVideo.model");
const logic = require("./aiVideo.logic");
const { httpError, insufficientCredits } = require("./aiVideo.errors");

// Drops expired purchases and makes `credits` match what is still usable.
async function sweep(studio) {
  if (!studio || !Array.isArray(studio.creditLots) || studio.creditLots.length === 0) return studio;
  const lots = logic.freshLots(studio.creditLots);
  const credits = logic.lotBalance(studio.creditLots);
  if (credits === studio.credits && lots.length === studio.creditLots.length) return studio;
  const updated = await Studio.findByIdAndUpdate(studio._id, { $set: { credits, creditLots: lots } }, { new: true });
  return updated || studio;
}

// Takes `cost` credits. Studios that have purchase lots spend those lots, soonest expiry first.
// Older studios with only a balance keep the plain balance check.
async function charge(studio, cost) {
  const amount = Math.max(0, Math.floor(Number(cost) || 0));
  if (!amount) return studio;
  const current = await sweep(studio);
  const tracked = Array.isArray(current.creditLots) && current.creditLots.length > 0;
  if (!tracked) {
    const reserved = await Studio.findOneAndUpdate(
      { _id: current._id, credits: { $gte: amount } },
      { $inc: { credits: -amount } },
      { new: true },
    );
    if (!reserved) throw insufficientCredits(current.credits, amount);
    return reserved;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const doc = attempt === 0 ? current : await sweep(await Studio.findById(current._id));
    const have = logic.lotBalance(doc.creditLots);
    if (have < amount) throw insufficientCredits(have, amount);
    const lots = logic.consumeLots(doc.creditLots, amount);
    const updated = await Studio.findOneAndUpdate(
      { _id: doc._id, credits: doc.credits },
      { $set: { credits: have - amount, creditLots: lots } },
      { new: true },
    );
    if (updated) return updated;
  }
  throw httpError(409, "Please try that again.");
}

// Puts credits back. A studio that tracks lots gets a fresh 30-day lot so the refund is not wiped.
async function refund(studioId, amount) {
  const credits = Math.max(0, Math.floor(Number(amount) || 0));
  if (!studioId || !credits) return;
  const studio = await Studio.findById(studioId).select("creditLots");
  if (studio && Array.isArray(studio.creditLots) && studio.creditLots.length) {
    const lot = logic.makeLot({ credits, days: 30, orderId: "refund" });
    await Studio.updateOne({ _id: studioId }, { $inc: { credits }, $push: { creditLots: lot } });
    return;
  }
  await Studio.updateOne({ _id: studioId }, { $inc: { credits } });
}

// Fields to add onto the paid-order update. The first purchase also records the balance
// the studio already had, so expiry does not wipe credits that were there before.
function grantUpdate(studio, order) {
  const grant = logic.makeLot({ credits: order.credits, days: order.termDays || 30, orderId: order.id });
  const pushes = [grant];
  if (!(Array.isArray(studio.creditLots) && studio.creditLots.length) && studio.credits > 0) {
    pushes.unshift(logic.makeLot({ credits: studio.credits, days: 30, orderId: "balance" }));
  }
  return { $inc: { credits: order.credits }, $push: { creditLots: { $each: pushes } } };
}

module.exports = { sweep, charge, refund, grantUpdate };
