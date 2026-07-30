const Company = require("../models/commpanyModelV2");
const User = require("../models/userModel");
const admin = require("firebase-admin");
const logger = require("../utils/logger");
const {deleteFileFromObjectStorage} = require("../middlewares/multer");

// Get company details
exports.getCompany = async (req, res) => {
  try {
    const company = await Company.findOne();
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.status(200).json({ 
      success: true, 
      data: {
        ...company.toObject(),
        banner: company.homeBannerImages 
      } 
    });
  } catch (error) {
    res.status(500).json({success: false, message: error.message });
  }
};

// Update company details
exports.updateCompany = async (req, res) => {
  const updates = {
    name: req.body.name,
    address: req.body.address,
    phone: req.body.phone,
    email: req.body.email,
    website: req.body.website,
    returnPolicy: req.body.returnPolicy,
    termsAndConditions: req.body.termsAndConditions,
    privacyPolicy: req.body.privacyPolicy,
    paymentGetWayFee: req.body.paymentGetWayFee,
    serviceFee: req.body.serviceFee,
    gstFee: req.body.gstFee,
  };
  if (req.body.homeBannerUrl !== undefined) {
    updates.homeBannerUrl = req.body.homeBannerUrl;
  }
  // Handle banner slot removals (admin sends removeBannerIndex=0,1,2)
  if (req.body.removeBannerIndex !== undefined) {
    updates._removeBannerIndex = Number(req.body.removeBannerIndex);
  }

  if (req.files) {
    if (req.files.logo) {
      updates.logo = req.files.logo[0].location;
    }
    if (req.files.favicon) {
      updates.favicon = req.files.favicon[0].location;
    }
    // banner1, banner2, banner3 are the 3 slots
    ["banner1", "banner2", "banner3"].forEach((slot, idx) => {
      if (req.files[slot]) {
        updates[`_bannerSlot_${idx}`] = req.files[slot][0].location;
      }
    });
  }

  try {
    const company = await Company.findOne();
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    // Delete old files from object storage if new files are uploaded
    if (req.files) {
      if (req.files.logo && company.logo) {
        await deleteFileFromObjectStorage(company?.logo);
      }
      if (req.files.favicon && company.favicon) {
        await deleteFileFromObjectStorage(company?.favicon);
      }
    }

    // Merge banner slots into homeBannerImages array
    const bannerImages = [...(company.homeBannerImages || [])];
    while (bannerImages.length < 3) bannerImages.push(null);

    ["banner1", "banner2", "banner3"].forEach((slot, idx) => {
      const newUrl = updates[`_bannerSlot_${idx}`];
      if (newUrl) {
        if (bannerImages[idx]) deleteFileFromObjectStorage(bannerImages[idx]).catch(() => {});
        bannerImages[idx] = newUrl;
        delete updates[`_bannerSlot_${idx}`];
      }
    });

    // Handle removals
    ["removeBanner1", "removeBanner2", "removeBanner3"].forEach((key, idx) => {
      if (req.body[key] === "true") {
        if (bannerImages[idx]) deleteFileFromObjectStorage(bannerImages[idx]).catch(() => {});
        bannerImages[idx] = null;
      }
    });

    updates.homeBannerImages = bannerImages.filter(Boolean);

    await Company.findOneAndUpdate({}, updates, { new: true });
    res.status(200).json({
      success: true,
      message: "Company details updated successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false,message: error.message });
  }
};


exports.toggleMaintenance = async (req, res) => {
  try {
    const company = await Company.findOne();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    company.isUnderMaintenance = !company?.isUnderMaintenance;
    await company.save();

    // Update global cache
    global.isUnderMaintenance = !!company.isUnderMaintenance;
    logger.info(`Maintenance status cache updated: ${global.isUnderMaintenance}`);

    broadcastMaintenanceNotification(global.isUnderMaintenance).catch(err => 
      logger.error("Error broadcasting maintenance notification:", err)
    );

    // Emit Socket.io event for real-time update
    if (global.io) {
      global.io.emit("maintenanceUpdate", {
        isUnderMaintenance: global.isUnderMaintenance
      });
      logger.info(`Maintenance broadcast sent via Socket.io: ${global.isUnderMaintenance}`);
    }

    res.json({
      success: true,
      message: `Maintenance mode ${company?.isUnderMaintenance ? "enabled" : "disabled"} successfully`,
      isUnderMaintenance: company?.isUnderMaintenance
    });
  } catch (err) {
    console.error("Toggle Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Update app version settings (for force update)
exports.updateAppVersion = async (req, res) => {
  try {
    const { minimumAppVersion, minimumVersionCode, latestAppVersion, latestVersionCode, forceUpdateEnabled, playStoreUrl } = req.body;

    const company = await Company.findOne();
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    if (minimumAppVersion !== undefined) company.minimumAppVersion = minimumAppVersion;
    if (minimumVersionCode !== undefined) company.minimumVersionCode = Number(minimumVersionCode);
    if (latestAppVersion !== undefined) company.latestAppVersion = latestAppVersion;
    if (latestVersionCode !== undefined) company.latestVersionCode = Number(latestVersionCode);
    if (forceUpdateEnabled !== undefined) company.forceUpdateEnabled = forceUpdateEnabled;
    if (playStoreUrl !== undefined) company.playStoreUrl = playStoreUrl;

    await company.save();

    res.json({
      success: true,
      message: "App version settings updated successfully",
      data: {
        minimumAppVersion: company.minimumAppVersion,
        minimumVersionCode: company.minimumVersionCode,
        latestAppVersion: company.latestAppVersion,
        latestVersionCode: company.latestVersionCode,
        forceUpdateEnabled: company.forceUpdateEnabled,
        playStoreUrl: company.playStoreUrl,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

async function broadcastMaintenanceNotification(isUnderMaintenance) {
  try {
    if (!admin.apps.length) {
      const serviceAccount = require("../config/serviceAccountKey.json");
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    const users = await User.find({ fcm: { $exists: true, $ne: null } }).select("fcm");
    const tokens = [...new Set(users.flatMap(u => (Array.isArray(u.fcm) ? u.fcm : [u.fcm])))].filter(Boolean);

    if (tokens.length === 0) {
      console.log("No FCM tokens found for broadcast");
      return;
    }

    // Send in chunks of 500
    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        data: {
          type: "maintenance_toggle",
          isUnderMaintenance: String(isUnderMaintenance)
        },
      });
    }
    console.log(`Maintenance broadcast sent to ${tokens.length} tokens`);
  } catch (error) {
    console.error("Maintenance broadcast failed:", error);
  }
}