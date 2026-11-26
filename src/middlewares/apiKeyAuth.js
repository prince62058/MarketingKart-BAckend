const developer = require("../services/whatsappDeveloperService");

module.exports = async function apiKeyAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const raw = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : String(req.get("x-api-key") || "").trim();
  if (!raw) {
    return res.status(401).json({ success: false, message: "Send the project key in Authorization: Bearer mk_live_…" });
  }
  try {
    const found = await developer.authenticate(raw);
    if (found?.disabled) {
      return res.status(403).json({ success: false, message: "This account is disabled" });
    }
    if (!found?.user || !found?.key) {
      return res.status(401).json({ success: false, message: "This project key is not valid" });
    }
    req.user = found.user;
    req.apiKey = found.key;
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "Could not check the project key" });
  }
};
