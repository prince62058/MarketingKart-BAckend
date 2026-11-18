const reelSampleModel = require("../models/reelSampleModel");

const SLOTS = [1, 2, 3];

const present = (slot, row) => ({
  slot,
  title: (row && row.title) || `Sample ${slot}`,
  video: (row && row.video) || "",
  thumbnail: (row && row.thumbnail) || "",
});

exports.listReelSamples = async (req, res) => {
  const rows = await reelSampleModel.find({ slot: { $in: SLOTS } }).lean();
  const bySlot = new Map(rows.map((row) => [row.slot, row]));
  res.json({
    success: true,
    message: "Reel samples fetched",
    data: SLOTS.map((slot) => present(slot, bySlot.get(slot))),
  });
};

exports.saveReelSample = async (req, res) => {
  const slot = Number(req.params.slot);
  if (!SLOTS.includes(slot)) {
    return res.status(400).json({ success: false, message: "Choose sample 1, 2, or 3." });
  }

  const video = req.files?.video?.[0]?.location;
  const thumbnail = req.files?.thumbnail?.[0]?.location;
  const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 60) : "";
  const update = {};
  if (video) update.video = video;
  if (thumbnail) update.thumbnail = thumbnail;
  if (title) update.title = title;

  if (!video && !thumbnail && !title) {
    return res.status(400).json({ success: false, message: "Add a title or upload a video." });
  }

  const saved = await reelSampleModel.findOneAndUpdate(
    { slot },
    { $set: update, $setOnInsert: { slot, title: title || `Sample ${slot}` } },
    { new: true, upsert: true }
  );

  res.json({ success: true, message: "Sample saved. It shows in the app now.", data: present(slot, saved) });
};
