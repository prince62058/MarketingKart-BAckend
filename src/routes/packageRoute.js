const express = require('express');
const {createPackage,getPackageById,updatePackage,getAllPackages,deletePackage} = require("../controllers/packageController");
const { upload } = require('../middlewares/multer');
const { adminOnly } = require('../middlewares/authMidd');
const router = express.Router();

// Example route for fetching all packages
router.get('/getAllPackages', getAllPackages);

// Example route for creating a new package
router.post('/createPackage',adminOnly,upload.single("image"),createPackage );

// Example route for fetching a specific package by ID
router.get('/packages/:id',getPackageById);

// Example route for updating a package by ID
router.put('/packages/:id', adminOnly, updatePackage);
router.delete('/deletePackage/:id', adminOnly, deletePackage);


module.exports = router;