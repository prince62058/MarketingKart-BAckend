const Staff = require("../models/staffModel");
const User = require("../models/userModel");
const Business = require("../models/businessModel");
const mongoose = require('mongoose');
const { hashPassword } = require('../helpers/passwordHash');
const { rebalanceAllAssignments } = require("../services/autoAssignService");

// Add new staff member (Admin only)
const addStaff = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { userId, role = 'STAFF', permissions = [] } = req.body;
    // Only these fields describe the new staff login; nothing else from the body reaches the user.
    const userData = {
      name: typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 80) : undefined,
      email: typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 120) : undefined,
      mobile: req.body.mobile,
    };
    

    
    // Check if user exists, if not create one
    let user = null;
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId).session(session);
    }
    
    if (!user) {
      // Create new user if not exists
      // A new staff login needs its own password of at least 8 characters (no shared default).
      if (typeof req.body.password !== 'string' || req.body.password.length < 8) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ status: false, message: 'Set a password of at least 8 characters for this staff member' });
      }
      const encryptedPassword = hashPassword(req.body.password);
      
      user = new User({
        _id: (userId && mongoose.Types.ObjectId.isValid(userId)) ? userId : new mongoose.Types.ObjectId(),
        ...userData,
        password: encryptedPassword,
        role: 1, // Staff role
        userType: 'ADMIN',
      });
      
      await user.save({ session });
    } else {
      // Update existing user to staff role if needed
      if (user.role !== 1) {
        user.role = 1;
        user.userType = 'ADMIN';
        await user.save({ session });
      }
    }
    
    // Check if staff already exists for this user
    const existingStaff = await Staff.findOne({ userId: user?._id }).session(session);
    if (existingStaff) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        status: false,
        message: 'Staff already exists for this user'
      });
    }

    // Create staff record with admin's businesses
    const staff = new Staff({
      userId: user._id,
      role: role.toUpperCase(),
      permissions: Array.isArray(permissions) ? permissions : [],
      isActive: true,
    });

    await staff.save({ session });

    // Globally re-balance all assignments to include the new staff member
    await rebalanceAllAssignments();

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      status: true,
      message: 'Staff added successfully',
      data: await staff.populate('userId', 'name email')
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error adding staff:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Failed to add staff',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update staff member
const updateStaff = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { staffId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(staffId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ status: false, message: 'Invalid staff ID' });
    }

    const { password } = req.body;
    // Only the staff record's own settings may change here.
    const updates = {};
    for (const k of ['role', 'isActive', 'permissions', 'businesses']) if (req.body[k] !== undefined) updates[k] = req.body[k];
    
    // Find staff
    const staff = await Staff.findById(staffId).session(session);
    if (!staff) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ 
        status: false, 
        message: 'Staff not found' 
      });
    }

    // Update user details if needed
    const userUpdates = {};
    let shouldUpdateUser = false;

    // Handle password update
    if (password) {
      if (typeof password !== 'string' || password.length < 8) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ status: false, message: 'Password must be at least 8 characters' });
      }
      userUpdates.password = hashPassword(password);
      shouldUpdateUser = true;
    }

    // Handle isActive status
    if (updates.isActive !== undefined) {
      // A deactivated staff member is no longer an admin anywhere.
      userUpdates.role = updates.isActive ? 1 : 0;
      userUpdates.userType = updates.isActive ? 'ADMIN' : 'USER';
      shouldUpdateUser = true;
    }

    // Update user if needed
    if (shouldUpdateUser) {
      await User.findByIdAndUpdate(
        staff.userId,
        { $set: userUpdates },
        { session }
      );
    }

    // Update staff record
    const updatedStaff = await Staff.findByIdAndUpdate(
      staffId,
      { $set: updates },
      { new: true, session }
    ).populate('userId', 'name email mobile');
    
    // If staff was deactivated, re-balance all assignments among remaining active staff
    if (updates.isActive === false) {
      await rebalanceAllAssignments();
    }

    await session.commitTransaction();
    session.endSession();

    res.json({
      status: true,
      message: 'Staff updated successfully',
      data: updatedStaff
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error updating staff:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Failed to update staff',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get staff by ID
const getStaff = async (req, res) => {
  try {
    const { staffId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(staffId)) {
      return res.status(400).json({ status: false, message: 'Invalid staff ID' });
    }
    
    const staff = await Staff.findOne({
      _id: staffId,
      isActive: true
    })
    .populate('userId', 'name email mobile')
    .populate('businesses', 'name description')
    .populate('updatedBy', 'name');

    if (!staff) {
      return res.status(404).json({ status: false, message: 'Staff not found or access denied' });
    }

    res.json({
      status: true,
      data: staff
    });
  } catch (error) {
    console.error('Error fetching staff:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Failed to retrieve staff',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};



const getAllStaff = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      isActive,
      search
    } = req.query;

    const query = {};
    
    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: require("../helpers/escapeRegex")(search), $options: 'i' } },
          { email: { $regex: require("../helpers/escapeRegex")(search), $options: 'i' } }
        ]
      }).select('_id');
      const userIds = users.map(u => u._id);
      query.userId = { $in: userIds };
    }
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    let staff = await Staff.find(query)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .sort({ createdAt: -1 })
      .populate('userId', 'name email mobile')
      .populate('businesses', 'name');

    const count = await Staff.countDocuments(query);

    staff = staff.map((s) => (s.toObject ? s.toObject() : { ...s }));

    res.json({
      status: true,
      data: staff,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (error) {
    console.error('Error getting staff:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Failed to retrieve staff',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete staff (soft delete)
const deleteStaff = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try { 
    const { staffId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(staffId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ status: false, message: 'Invalid staff ID' });
    }

    // Hard delete staff
    const staff = await Staff.findByIdAndDelete(staffId, { session });
    
    if (!staff) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ 
        status: false, 
        message: 'Staff not found' 
      });
    }

    // Update user role
    await User.findByIdAndUpdate(
      staff.userId,
      { $set: { role: 0, userType: 'USER' } },
      { session }
    );

    // Re-balance all assignments
    await rebalanceAllAssignments();

    await session.commitTransaction();
    session.endSession();

    res.json({
      status: true,
      message: 'Staff deleted permanently'
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error deactivating staff:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Failed to deactivate staff',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get businesses assigned to staff
const getStaffBusinesses = async (req, res) => {
  try {
    const { staffId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(staffId)) {
      return res.status(400).json({ status: false, message: 'Invalid staff ID' });
    }
    
    // Get staff with businesses
    const staff = await Staff.findById(staffId)
      .select('businesses')
      .populate('businesses', 'name description');

    if (!staff) {
      return res.status(404).json({ 
        status: false, 
        message: 'Staff not found' 
      });
    }

    res.json({
      status: true,
      data: staff.businesses
    });
  } catch (error) {
    console.error('Error fetching staff businesses:', error);
    res.status(500).json({ status: false, message: 'Server error', error: error.message });
  }
};

module.exports = {
  addStaff,
  updateStaff,
  getStaff,
  getAllStaff,
  deleteStaff,
  getStaffBusinesses
};
