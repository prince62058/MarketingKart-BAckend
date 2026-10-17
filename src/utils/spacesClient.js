const AWS = require("aws-sdk");
const path = require("path");

function spaces() {
  const endpoint = process.env.DO_SPACES_ENDPOINT;
  if (!endpoint || !process.env.DO_SPACES_KEY || !process.env.DO_SPACES_SECRET || !process.env.DO_SPACES_BUCKET) {
    throw new Error("DigitalOcean Spaces is not configured");
  }
  return new AWS.S3({
    endpoint: new AWS.Endpoint(endpoint),
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
    region: process.env.DO_SPACES_REGION || "sgp1",
    signatureVersion: "v4",
    s3ForcePathStyle: true,
  });
}

function rootFolder() {
  return (process.env.DO_SPACES_FOLDER || "MarketingKart").replace(/^\/+|\/+$/g, "");
}

function extensionFor(mimetype = "", name = "") {
  if (path.extname(name || "")) return "";
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/3gpp": ".3gp",
    "application/pdf": ".pdf",
    "text/csv": ".csv",
    "text/plain": ".txt",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  };
  return map[mimetype] || "";
}

function objectKey(folder, publicId, mimetype) {
  const root = rootFolder();
  let rest = String(folder || "").replace(/^\/+|\/+$/g, "");
  rest = rest.replace(/^(MarketingKart|MARKETINGKART|Wellmaats)\/?/i, "");
  const name = String(publicId || `${Date.now()}`).replace(/^\/+/, "");
  return [root, rest, `${name}${extensionFor(mimetype, name)}`].filter(Boolean).join("/");
}

function publicUrl(key) {
  const cdn = (process.env.DO_SPACES_CDN_URL || "").replace(/\/+$/, "");
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  if (cdn) return `${cdn}/${encoded}`;
  const endpoint = (process.env.DO_SPACES_ENDPOINT || "").replace(/\/+$/, "");
  return `${endpoint}/${process.env.DO_SPACES_BUCKET}/${encoded}`;
}

function keyFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const cdn = (process.env.DO_SPACES_CDN_URL || "").replace(/\/+$/, "");
  const bucket = process.env.DO_SPACES_BUCKET;
  let pathPart = null;
  if (cdn && url.startsWith(`${cdn}/`)) pathPart = url.slice(cdn.length + 1);
  else if (bucket && url.includes(`/${bucket}/`)) pathPart = url.split(`/${bucket}/`)[1];
  if (!pathPart) return null;
  return decodeURIComponent(pathPart.split("?")[0]);
}

function uploadBuffer(buffer, { folder, publicId, mimetype } = {}) {
  const Body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const Key = objectKey(folder, publicId, mimetype);
  return spaces()
    .upload({
      Bucket: process.env.DO_SPACES_BUCKET,
      Key,
      Body,
      ACL: "public-read",
      ContentType: mimetype || "application/octet-stream",
    })
    .promise()
    .then(() => ({
      secure_url: publicUrl(Key),
      public_id: Key,
      bytes: Body.length,
    }));
}

async function deleteByUrl(url) {
  const Key = keyFromUrl(url);
  if (!Key) return;
  try {
    await spaces().deleteObject({ Bucket: process.env.DO_SPACES_BUCKET, Key }).promise();
  } catch (error) {
    console.error(`[SPACES] Error deleting file: ${error.message}`);
  }
}

function resourceTypeFor(mimetype = "") {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return "raw";
}

module.exports = { uploadBuffer, deleteByUrl, resourceTypeFor, publicUrl, objectKey, keyFromUrl };
