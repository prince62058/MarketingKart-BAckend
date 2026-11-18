const reelSampleModel = require("../models/reelSampleModel");

const SLOTS = [1, 2, 3];
const KINDS = ["ugc", "ai"];

let indexesReady = false;
async function ensureIndexes() {
  if (indexesReady) return;
  try {
    await reelSampleModel.collection.dropIndex("slot_1");
  } catch (_) {
    // The first version indexed slot alone. UGC and AI each need slots 1–3.
  }
  await reelSampleModel.syncIndexes();
  indexesReady = true;
}

const present = (kind, slot, row) => ({
  kind,
  slot,
  title: (row && row.title) || `Sample ${slot}`,
  video: (row && row.video) || "",
  thumbnail: (row && row.thumbnail) || "",
});

exports.listReelSamples = async (req, res) => {
  await ensureIndexes();
  const rows = await reelSampleModel.find({ kind: { $in: KINDS }, slot: { $in: SLOTS } }).lean();
  const data = [];
  for (const kind of KINDS) {
    for (const slot of SLOTS) {
      const row = rows.find((item) => item.kind === kind && item.slot === slot);
      data.push(present(kind, slot, row));
    }
  }
  res.json({ success: true, message: "Reel samples fetched", data });
};

exports.saveReelSample = async (req, res) => {
  await ensureIndexes();
  const kind = String(req.params.kind || "").toLowerCase();
  const slot = Number(req.params.slot);
  if (!KINDS.includes(kind) || !SLOTS.includes(slot)) {
    return res.status(400).json({ success: false, message: "Choose UGC or AI, and sample 1, 2, or 3." });
  }

  const video = req.files?.video?.[0]?.location;
  const thumbnail = req.files?.thumbnail?.[0]?.location;
  const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 60) : "";
  const update = { kind };
  if (video) update.video = video;
  if (thumbnail) update.thumbnail = thumbnail;
  if (title) update.title = title;

  if (!video && !thumbnail && !title) {
    return res.status(400).json({ success: false, message: "Add a title or upload a vertical reel." });
  }

  const saved = await reelSampleModel.findOneAndUpdate(
    { kind, slot },
    { $set: update, $setOnInsert: { kind, slot, title: title || `Sample ${slot}` } },
    { new: true, upsert: true }
  );

  res.json({
    success: true,
    message: "Sample saved. It shows on that reel in the app now.",
    data: present(kind, slot, saved),
  });
};
