const express = require("express");
const multer = require("multer");
const { authUser, isAdmin } = require("../../middlewares/authMidd");
const asyncHandler = require("../../utils/asyncHandler");
const controller = require("./aiVideo.controller");

const router = express.Router();
const guard = asyncHandler(authUser);

// Photos go straight to the video provider, so they are held in memory, never on disk.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const photoParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (["image/jpeg", "image/jpg", "image/png"].includes(file.mimetype)) return cb(null, true);
    const error = new Error("Use a JPG or PNG photo.");
    error.status = 400;
    cb(error, false);
  },
}).single("photo");

function photoUpload(req, res, next) {
  photoParser(req, res, error => {
    if (!error) return next();
    const message =
      error.code === "LIMIT_FILE_SIZE" ? "That photo is too large. Use one under 8 MB." : error.message || "Photo upload failed.";
    return controller.fail(res, Object.assign(new Error(message), { status: 400 }));
  });
}

router.get("/ai-video/studio", guard, controller.studio);
router.patch("/ai-video/goal", guard, controller.goal);
router.post("/ai-video/scripts", guard, controller.script);
router.post("/ai-video/projects", guard, controller.createProject);
router.get("/ai-video/projects/:id", guard, controller.project);
router.delete("/ai-video/projects/:id", guard, controller.deleteProject);
router.get("/ai-video/voice-preview", guard, controller.voicePreview);
router.get("/ai-video/voices", guard, controller.listVoices);
router.post("/ai-video/voiceovers", guard, controller.voiceover);
router.post("/ai-video/avatars", guard, photoUpload, controller.createAvatar);
// Video avatars: the footage goes from the phone straight to storage, so this server only
// hands out the upload slot, then finishes the job and starts the consent step.
router.post("/ai-video/avatars/video/init", guard, controller.initVideoAvatar);
router.post("/ai-video/avatars/:id/video/complete", guard, controller.completeVideoAvatar);
router.post("/ai-video/avatars/:id/consent", guard, controller.avatarConsent);
router.get("/ai-video/avatars/:id", guard, controller.avatar);
router.patch("/ai-video/avatars/:id", guard, controller.patchAvatar);
router.delete("/ai-video/avatars/:id", guard, controller.deleteAvatar);
router.post("/ai-video/orders", guard, controller.order);
router.post("/ai-video/orders/confirm", guard, controller.confirmOrder);
router.post("/ai-video/orders/:id/wallet", guard, controller.walletOrder);
// Public on purpose: Razorpay cannot log in. The handler rejects anything without a valid signature.
router.post("/ai-video/webhooks/razorpay", controller.razorpayWebhook);
router.post("/ai-video/enterprise", guard, controller.enterprise);
router.get("/ai-video/provider-status", guard, isAdmin, controller.providerStatus);

module.exports = router;
