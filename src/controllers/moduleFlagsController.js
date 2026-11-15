const moduleFlags = require("../services/moduleFlagsService");

const isAdminUser = (user) =>
  user?.userType === "ADMIN" || user?.role === "ADMIN" || user?.userType === "STAFF";

exports.getFlags = async (req, res) => {
  try {
    const data = await moduleFlags.get({ fresh: false });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateFlags = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can update module flags" });
    }
    const data = await moduleFlags.update(req.body || {}, req.user);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

exports.toggleModule = async (req, res) => {
  try {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: "Only admins can toggle modules" });
    }
    const key = String(req.params.module || "").trim();
    const current = await moduleFlags.get({ fresh: true });
    if (!(key in current) || key === "messages") {
      return res.status(400).json({ success: false, message: "Unknown module" });
    }
    const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !current[key];
    const data = await moduleFlags.setModule(key, enabled, req.user);
    return res.status(200).json({
      success: true,
      message: `${key} ${data[key] ? "enabled" : "under maintenance"}`,
      data,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};
