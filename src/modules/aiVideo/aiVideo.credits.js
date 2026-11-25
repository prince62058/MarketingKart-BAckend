const crypto = require("crypto");
const Studio = require("./aiVideo.model");
const logic = require("./aiVideo.logic");
const { httpError, insufficientCredits } = require("./aiVideo.errors");

function holdsOf(doc) {
  return Math.max(0, Math.floor(Number(doc && doc.creditHolds) || 0));
}

function holdFilter(doc) {
  return doc && doc.creditHolds == null ? { $in: [null, 0] } : doc.creditHolds;
}

function trackedLots(doc) {
  return Array.isArray(doc.creditLots) && doc.creditLots.length > 0;
}

// Drops expired purchases and makes `credits` match what is still usable.
// Credits locked for a video that is still rendering are kept until that video finishes.
async function sweep(studio) {
  if (!studio || !Array.isArray(studio.creditLots) || studio.creditLots.length === 0) return studio;
  const lots = logic.freshLots(studio.creditLots);
  const balance = logic.lotBalance(studio.creditLots);
  const credits = Math.max(balance, holdsOf(studio));
  if (credits === studio.credits && lots.length === studio.creditLots.length) return studio;
  const updated = await Studio.findByIdAndUpdate(studio._id, { $set: { credits, creditLots: lots } }, { new: true });
  return updated || studio;
}

// Takes `cost` credits now. Used for things that finish in this request (a voice, an avatar).
// Credits locked by an unfinished video cannot be spent here.
async function charge(studio, cost) {
  const amount = Math.max(0, Math.floor(Number(cost) || 0));
  if (!amount) return studio;
  const current = await sweep(studio);
  if (!trackedLots(current)) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const doc = attempt === 0 ? current : await sweep(await Studio.findById(current._id));
      const reserved = holdsOf(doc);
      const available = doc.credits - reserved;
      if (available < amount) throw insufficientCredits(available, amount, reserved);
      const updated = await Studio.findOneAndUpdate(
        { _id: doc._id, credits: { $gte: amount + reserved }, creditHolds: holdFilter(doc) },
        { $inc: { credits: -amount } },
        { new: true },
      );
      if (updated) return updated;
    }
    throw httpError(409, "Please try that again.");
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const doc = attempt === 0 ? current : await sweep(await Studio.findById(current._id));
    const reserved = holdsOf(doc);
    const have = logic.lotBalance(doc.creditLots);
    const available = have - reserved;
    if (available < amount) throw insufficientCredits(Math.max(0, available), amount, reserved);
    const lots = logic.consumeLots(doc.creditLots, amount);
    const updated = await Studio.findOneAndUpdate(
      { _id: doc._id, credits: doc.credits, creditHolds: holdFilter(doc) },
      { $set: { credits: have - amount, creditLots: lots } },
      { new: true },
    );
    if (updated) return updated;
  }
  throw httpError(409, "Please try that again.");
}

// Locks credits for a video without taking them. The balance the customer sees stays put.
// Two renders cannot lock the same credits: the check and the lock are one document update.
async function hold(studio, cost) {
  const amount = Math.max(0, Math.floor(Number(cost) || 0));
  if (!amount) return studio;
  const current = await sweep(studio);
  const reserved = holdsOf(current);
  const available = current.credits - reserved;
  if (available < amount) throw insufficientCredits(Math.max(0, available), amount, reserved);

  const stamp = crypto.randomBytes(8).toString("hex");
  const held = { $ifNull: ["$creditHolds", 0] };
  const balance = { $ifNull: ["$credits", 0] };
  const canHold = { $gte: [{ $subtract: [balance, held] }, amount] };
  const updated = await Studio.findOneAndUpdate(
    { _id: current._id },
    [
      {
        $set: {
          creditHolds: { $cond: [canHold, { $add: [held, amount] }, held] },
          creditHoldStamp: { $cond: [canHold, stamp, "$creditHoldStamp"] },
        },
      },
    ],
    { new: true },
  );
  if (!updated || updated.creditHoldStamp !== stamp) {
    const left = holdsOf(updated || current);
    const still = Math.max(0, ((updated && updated.credits) || current.credits) - left);
    throw insufficientCredits(still, amount, left);
  }
  return updated;
}

// Drops a lock. Does not add credits, because a lock was never a charge.
async function release(studioId, amount) {
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  if (!studioId || !cost) return false;
  const updated = await Studio.updateOne(
    { _id: studioId, creditHolds: { $gte: cost } },
    { $inc: { creditHolds: -cost } },
  );
  return updated.modifiedCount > 0;
}

function projectSet(fields) {
  const $set = {};
  for (const [key, value] of Object.entries(fields)) $set[`projects.$.${key}`] = value;
  return $set;
}

// Charges a finished video exactly once and writes its result in the same update.
// A second poller finds the video already charged and does not take the credits again.
async function captureRender(studioId, projectId, amount, fields) {
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  if (!cost) return { state: "short" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const doc = await Studio.findById(studioId);
    if (!doc) return { state: "missing" };
    const project = (doc.projects || []).find(item => item.id === projectId);
    if (!project) return { state: "missing" };
    if (project.charged || project.status === "Completed") return { state: "already", studio: doc };
    if (project.billing !== "on_complete") return { state: "legacy", studio: doc };
    if (project.status !== "Rendering") return { state: "closed", studio: doc };

    const reserved = holdsOf(doc);
    const tracked = trackedLots(doc);
    let nextCredits = doc.credits;
    let nextLots = doc.creditLots;
    if (doc.credits < cost || reserved < cost) return { state: "short", studio: doc };
    if (tracked) {
      const have = logic.lotBalance(doc.creditLots);
      if (have >= cost) {
        nextLots = logic.consumeLots(doc.creditLots, cost);
        nextCredits = have - cost;
      } else {
        // The locked credits outlived their lot. The balance was kept for this video.
        nextLots = [];
        nextCredits = doc.credits - cost;
      }
    } else {
      nextCredits = doc.credits - cost;
    }

    const $set = { credits: nextCredits, ...projectSet({ ...fields, charged: true }) };
    if (tracked || (Array.isArray(nextLots) && nextLots.length === 0 && trackedLots(doc))) $set.creditLots = nextLots;
    const updated = await Studio.findOneAndUpdate(
      {
        _id: doc._id,
        credits: doc.credits,
        creditHolds: holdFilter(doc),
        projects: { $elemMatch: { id: projectId, charged: { $ne: true }, status: "Rendering", billing: "on_complete" } },
      },
      { $set, $inc: { creditHolds: -cost } },
      { new: true },
    );
    if (updated) return { state: "captured", studio: updated };
  }
  return { state: "retry" };
}

// Closes a video that never finished and releases its lock. Credits are not added back,
// because they were never taken. The refunded flag makes a second poller a no-op.
async function releaseRender(studioId, projectId, amount, fields) {
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  const released = await Studio.findOneAndUpdate(
    {
      _id: studioId,
      creditHolds: { $gte: cost },
      projects: { $elemMatch: { id: projectId, refunded: { $ne: true }, charged: { $ne: true }, billing: "on_complete" } },
    },
    { $inc: { creditHolds: -cost }, $set: projectSet(fields) },
    { new: true },
  );
  if (released) return { state: "released", studio: released };

  const closed = await Studio.findOneAndUpdate(
    {
      _id: studioId,
      projects: { $elemMatch: { id: projectId, refunded: { $ne: true }, charged: { $ne: true }, billing: "on_complete" } },
    },
    { $set: projectSet(fields) },
    { new: true },
  );
  return closed ? { state: "closed", studio: closed } : { state: "already" };
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

module.exports = { sweep, charge, hold, release, captureRender, releaseRender, refund, grantUpdate };
