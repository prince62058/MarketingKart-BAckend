const dotenvPath = require('path').resolve(__dirname, '../../.env');
require("dotenv").config({ path: dotenvPath });
const multer = require("multer");
const path = require("path");
const { uploadBuffer, deleteByUrl } = require("../utils/spacesClient");

// File Upload Filter Function
function multerFilter(req, file, cb) {
  const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png"];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true); // Accept the file
  } else {
    const error = new Error("Only JPEG, JPG, or PNG formats allowed!");
    error.status = 400; // Set the status code as needed
    cb(error, false); // Reject the file with an error
  }
}

const sanitizeFileName = (originalName = "file") => {
  const ext = path.extname(originalName || "") || "";
  const base = path.basename(originalName || "file", ext);
  const normalizedBase = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeBase = normalizedBase || `file_${Date.now()}`;
  return `${safeBase}${ext.toLowerCase()}`;
};

// Multer storage engine that streams files straight to DigitalOcean Spaces.
// Exposes `location` (alongside `path`) so controllers reading
// `req.file.location` / `req.files.X[0].location` keep working unchanged.
class SpacesMulterStorage {
  constructor({ folder } = {}) {
    this.folderFn = folder;
  }

  _handleFile(req, file, cb) {
    const chunks = [];
    file.stream.on("data", chunk => chunks.push(chunk));
    file.stream.on("error", cb);
    file.stream.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const folder = typeof this.folderFn === "function" ? this.folderFn(req, file) : this.folderFn;
        const publicId = `${Date.now()}_${sanitizeFileName(file.originalname).replace(/\.[^/.]+$/, "")}`;
        const result = await uploadBuffer(buffer, { folder, mimetype: file.mimetype, publicId });
        cb(null, {
          location: result.secure_url,
          path: result.secure_url,
          filename: result.public_id,
          size: result.bytes,
        });
      } catch (error) {
        cb(error);
      }
    });
  }

  _removeFile(req, file, cb) {
    deleteByUrl(file.location).then(() => cb(null)).catch(() => cb(null));
  }
}

function folderForMimetype(mimetype = "") {
  if (mimetype.startsWith("image")) return "MARKETINGKART/IMAGE";
  if (mimetype.startsWith("video")) return "MARKETINGKART/VIDEO";
  if (mimetype.startsWith("application/pdf")) return "MARKETINGKART/PDF";
  return "MARKETINGKART/OTHERS";
}

// Multer Storage Configuration
// Files land in a public bucket and are served with the type the client sent, so anything a
// browser would run (HTML, SVG, XML, scripts) is refused; photos, videos, audio, PDFs and office
// files are what the apps upload.
const SAFE_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "application/octet-stream",
  "application/zip",
]);
const BLOCKED_EXTENSIONS = /\.(html?|xhtml|svg|svgz|xml|js|mjs|php|exe|sh|bat)$/i;
function safeUploadFilter(_req, file, cb) {
  const type = String(file.mimetype || "").toLowerCase();
  const media = /^(image|video|audio)\//.test(type) && !type.includes("svg");
  if ((media || SAFE_DOCUMENT_TYPES.has(type)) && !BLOCKED_EXTENSIONS.test(file.originalname || "")) return cb(null, true);
  const error = new Error("This file type is not allowed. Upload a photo, video, PDF or office file.");
  error.status = 400;
  return cb(error, false);
}

const upload = multer({
  storage: new SpacesMulterStorage({ folder: (req, file) => folderForMimetype(file.mimetype) }),
  fileFilter: safeUploadFilter,
  limits: { fileSize: 300 * 1024 * 1024, files: 20 },
});

// Export the upload function
exports.upload = upload;

// Excel/CSV Upload for WhatsApp Contact Import
const uploadExcel = multer({
  storage: new SpacesMulterStorage({ folder: "MARKETINGKART/EXCEL" }),
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error("Only Excel (.xlsx, .xls) or CSV files allowed!");
      error.status = 400;
      cb(error, false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

exports.uploadExcel = uploadExcel;

// WhatsApp Media Upload (Image/Video/Document for template headers)
const uploadWhatsAppMedia = multer({
  storage: new SpacesMulterStorage({
    folder: (req, file) => {
      let folderPath = "MARKETINGKART/WHATSAPP_MEDIA";
      if (file.mimetype.startsWith("image")) {
        folderPath += "/IMAGE";
      } else if (file.mimetype.startsWith("video")) {
        folderPath += "/VIDEO";
      } else {
        folderPath += "/DOCUMENT";
      }
      return folderPath;
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowed = [
      // Images
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      // Videos
      "video/mp4",
      "video/3gpp",
      "video/quicktime",
      // Documents
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error(
        "Unsupported file type. Allowed: JPG, PNG, WEBP, MP4, 3GP, PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX",
      );
      error.status = 400;
      cb(error, false);
    }
  },
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB max (Meta limit for most media)
});

exports.uploadWhatsAppMedia = uploadWhatsAppMedia;

const uploadReelMedia = multer({
  storage: new SpacesMulterStorage({ folder: "MARKETINGKART/REELS" }),
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/webm", "image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error("Use an MP4 video, or a JPG, PNG, or WEBP image.");
      error.status = 400;
      cb(error, false);
    }
  },
  limits: { fileSize: 40 * 1024 * 1024 },
});

exports.uploadReelMedia = uploadReelMedia;

// Function to Delete a File from Object Storage
exports.deleteFileFromObjectStorage = deleteByUrl;
