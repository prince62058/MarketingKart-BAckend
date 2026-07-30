const axios = require("axios");
const { uploadBuffer } = require("./cloudinaryClient");
const path = require("path");

const fs = require("fs");

/**
 * Downloads an image from a URL and uploads it to the configured S3/Linode bucket.
 * @param {string} url - The source image URL.
 * @param {string} folderPath - The folder path in the bucket (e.g., "LEADKART/IMAGE/META/").
 * @returns {Promise<string|null>} - The public URL of the uploaded image, or null on failure.
 */
async function uploadUrlToBucket(url, folderPath) {
  try {
    if (!url) return null;

    console.log(`[BUCKET] Downloading image from: ${url}`);
    const response = await axios({
      url,
      method: "GET",
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(response.data, "binary");
    return uploadBufferToBucket(buffer, folderPath, response.headers["content-type"] || "image/jpeg");
  } catch (error) {
    console.error(`[BUCKET] Error uploading URL to bucket: ${error.message}`);
    return null;
  }
}

/**
 * Uploads a local file to the configured S3/Linode bucket.
 * @param {string} filePath - Absolute path to the local file.
 * @param {string} folderPath - The folder path in the bucket.
 * @returns {Promise<string|null>} - The public URL of the uploaded image.
 */
async function uploadLocalFileToBucket(filePath, folderPath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.error(`[BUCKET] Local file not found: ${filePath}`);
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    const contentType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";
    return uploadBufferToBucket(buffer, folderPath, contentType);
  } catch (error) {
    console.error(`[BUCKET] Error uploading local file to bucket: ${error.message}`);
    return null;
  }
}

/**
 * Internal helper to upload a buffer to Cloudinary.
 */
async function uploadBufferToBucket(buffer, folderPath, contentType) {
  const publicId = `${Date.now()}_ad_asset`;
  const folder = folderPath.replace(/\/+$/, "");

  console.log(`[BUCKET] Uploading to Cloudinary folder: ${folder}`);
  const uploadResult = await uploadBuffer(buffer, { folder, mimetype: contentType, publicId });
  return uploadResult.secure_url;
}

module.exports = {
  uploadUrlToBucket,
  uploadLocalFileToBucket,
};
