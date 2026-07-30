const Package = require("../models/packegIncludeModel");

// Get all packages
exports.getAllPackages = async (req, res) => {
    try {
        const packages = await Package.find();
        res.status(200).json({success:true,message:"packages Fatch Successfully",data:packages});
    } catch (error) {
        res.status(500).json({ success:false,message: "Error fetching packages", error });
    }
};

// Get a single package by ID
exports.getPackageById = async (req, res) => {
    try {
        const package = await Package.findById(req.params.id);
        if (!package) {
            return res.status(404).json({ message: "Package not found" });
        }
        res.status(200).json(package);
    } catch (error) {
        res.status(500).json({ message: "Error fetching package", error });
    }
};

// Create a new package
exports.createPackage = async (req, res) => {
    try {
        const { title,  description } = req.body;
        let image = req.file ? req.file.location : null; 
        let obj = {
            title,
            image,
            description
        }// Assuming you're using multer for file uploads
        const newPackage = new Package(obj);
        const savedPackage = await newPackage.save();
        res.status(201).json({success:true,message:"Package Create Successfully.",data:savedPackage});
    } catch (error) {
        res.status(400).json({ success:false, message: "Error creating package", error });
    }
};

// Update a package by ID
exports.updatePackage = async (req, res) => {
  try {
    const updatedPackage = await Package.findByIdAndUpdate(
      req.params.id,
      { $set: req.body }, // Use $set to update only provided fields
      { new: true, runValidators: true }
    );
    if (!updatedPackage) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }
    res.status(200).json({ success: true, message: "Package updated successfully", data: updatedPackage });
  } catch (error) {
    res.status(400).json({ success: false, message: "Error updating package", error: error.message });
  }
};

// Delete a package by ID
exports.deletePackage = async (req, res) => {
    try {
        const deletedPackage = await Package.findByIdAndDelete(req.params.id);
        if (!deletedPackage) {
            return res.status(404).json({ message: "Package not found" });
        }
        res.status(200).json({ message: "Package deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting package", error });
    }
};