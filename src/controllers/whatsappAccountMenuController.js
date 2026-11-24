const Menu = require("../models/whatsappAccountMenuModel");
const { CATALOG, mergeMenu, visibleMenu } = require("../services/whatsappAccountMenu");

const isAdminUser = (user) => user?.userType === "ADMIN" || user?.role === "ADMIN" || user?.userType === "STAFF";

async function savedRows() {
  const existing = await Menu.find().lean();
  const known = new Set(existing.map((item) => item.key));
  const missing = CATALOG.filter((item) => !known.has(item.key));
  if (!missing.length) return existing;
  try {
    await Menu.insertMany(missing, { ordered: false });
  } catch (error) {
    const duplicate = error?.code === 11000 || error?.writeErrors?.every((item) => item?.code === 11000);
    if (!duplicate) throw error;
  }
  return Menu.find().lean();
}

exports.getAccountMenu = async (req, res) => {
  try {
    const rows = mergeMenu(await savedRows());
    if (req.query.all === "true") {
      if (!isAdminUser(req.user)) {
        return res.status(403).json({ success: false, message: "Only admins can edit the WhatsApp account menu" });
      }
      return res.status(200).json({ success: true, data: rows });
    }
    return res.status(200).json({ success: true, data: visibleMenu(rows) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveAccountMenu = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can edit the WhatsApp account menu" });
    }
    const rows = mergeMenu(await savedRows(), req.body?.items);
    await Menu.bulkWrite(rows.map((item) => ({
      updateOne: { filter: { key: item.key }, update: { $set: item }, upsert: true },
    })));
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
