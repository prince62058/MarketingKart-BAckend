const axios = require("axios");
const { uploadBuffer } = require("../../utils/spacesClient");
const logger = require("../../utils/logger");

const MAX_BYTES = 250 * 1024 * 1024;

const EXTENSIONS = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
};

// Provider links expire (HeyGen: 7 days), so finished files are copied to our own storage.
// Returns the permanent url, or null when storage is unavailable; callers then keep the
// provider link and refresh it on demand.
async function mirror(sourceUrl, { folder, name, fallbackMimetype }) {
  if (!/^https:\/\//i.test(String(sourceUrl || ""))) return null;
  try {
    const res = await axios.get(sourceUrl, {
      responseType: "arraybuffer",
      timeout: 180000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
    });
    const mimetype = String(res.headers["content-type"] || fallbackMimetype || "application/octet-stream")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const extension = EXTENSIONS[mimetype] || EXTENSIONS[fallbackMimetype] || "";
    const stored = await uploadBuffer(Buffer.from(res.data), {
      folder,
      publicId: `${name}${extension}`,
      mimetype: mimetype === "application/octet-stream" ? fallbackMimetype : mimetype,
    });
    return stored.secure_url;
  } catch (error) {
    // axios errors carry request config; log only the message.
    logger.error(`[AI VIDEO] could not copy ${name} to storage: ${error.message}`);
    return null;
  }
}

module.exports = { mirror };
