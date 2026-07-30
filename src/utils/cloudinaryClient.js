const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

if (!process.env.CLOUDINARY_API_SECRET) {
  console.error("CRITICAL ERROR: CLOUDINARY_API_SECRET is missing! Uploads will fail.");
}

function resourceTypeFor(mimetype = "") {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return "raw";
}

/**
 * Uploads a buffer to Cloudinary.
 * @returns {Promise<object>} the Cloudinary upload result (secure_url, public_id, bytes, ...).
 */
function uploadBuffer(buffer, { folder, resourceType, publicId, mimetype } = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType || resourceTypeFor(mimetype),
        public_id: publicId,
        overwrite: true,
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    uploadStream.end(buffer);
  });
}

/**
 * Deletes a previously uploaded asset given its secure_url. No-ops on non-Cloudinary URLs
 * (e.g. legacy Linode URLs from before the migration) so old references don't throw.
 */
async function deleteByUrl(url) {
  if (!url || typeof url !== "string" || !url.includes("res.cloudinary.com")) return;
  try {
    const afterUpload = url.split("/upload/")[1];
    if (!afterUpload) return;
    const withoutVersion = afterUpload.replace(/^v\d+\//, "");
    const publicId = withoutVersion.replace(/\.[^/.]+$/, "");
    const resourceType = url.includes("/video/upload/")
      ? "video"
      : url.includes("/raw/upload/")
      ? "raw"
      : "image";
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error(`[CLOUDINARY] Error deleting file: ${error.message}`);
  }
}

module.exports = { cloudinary, uploadBuffer, deleteByUrl, resourceTypeFor };
