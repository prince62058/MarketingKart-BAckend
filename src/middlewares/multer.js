const dotenvPath = require('path').resolve(__dirname, '../../.env');
require("dotenv").config({ path: dotenvPath });
const multer = require("multer");
const path = require("path");
const { uploadBuffer, deleteByUrl } = require("../utils/cloudinaryClient");

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

// Multer storage engine that streams files straight to Cloudinary. Exposes `location`
// (alongside `path`) on the resulting file object so existing controllers reading
// `req.file.location` / `req.files.X[0].location` keep working unchanged.
class CloudinaryMulterStorage {
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
  if (mimetype.startsWith("image")) return "LEADKART/IMAGE";
  if (mimetype.startsWith("video")) return "LEADKART/VIDEO";
  if (mimetype.startsWith("application/pdf")) return "LEADKART/PDF";
  return "LEADKART/OTHERS";
}

// Multer Storage Configuration
const upload = multer({
  storage: new CloudinaryMulterStorage({ folder: (req, file) => folderForMimetype(file.mimetype) }),
});

// Export the upload function
exports.upload = upload;

// Excel/CSV Upload for WhatsApp Contact Import
const uploadExcel = multer({
  storage: new CloudinaryMulterStorage({ folder: "LEADKART/EXCEL" }),
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
  storage: new CloudinaryMulterStorage({
    folder: (req, file) => {
      let folderPath = "LEADKART/WHATSAPP_MEDIA";
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

// Function to Delete a File from Object Storage
exports.deleteFileFromObjectStorage = deleteByUrl;
