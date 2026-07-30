const Staff = require("../models/staffModel");
const Business = require("../models/businessModel");
const User = require("../models/userModel");
const mongoose = require('mongoose');

// Auto assign businesses to staff members
const autoAssignBusinesses = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Only admin can auto-assign businesses
    if (req.user.role !== 1) {
      return res.status(403).json({ status: false, message: 'Only admin can auto-assign businesses' });
    }

    // Get all active staff members
    const staffMembers = await Staff.find({ isActive: true })
      .sort({ 'businesses.0': 1 }) // Sort by number of businesses (ascending)
      .session(session);

    if (staffMembers.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ status: false, message: 'No active staff members found' });
    }

    // Get all unassigned businesses (not assigned to any staff)
    const assignedBusinesses = new Set();
    staffMembers.forEach(staff => {
      staff.businesses.forEach(biz => assignedBusinesses.add(biz.toString()));
    });

    const allBusinesses = await Business.find({
      isDeleted: false
    }).session(session);

    const unassignedBusinesses = allBusinesses.filter(
      biz => !assignedBusinesses.has(biz._id.toString())
    );

    if (unassignedBusinesses.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.json({ 
        status: true, 
        message: 'All businesses are already assigned to staff members' 
      });
    }

    // Distribute businesses evenly among staff
    const assignments = [];
    let staffIndex = 0;

    for (const business of unassignedBusinesses) {
      const staff = staffMembers[staffIndex];
      
      // Add business to staff's businesses array if not already present
      if (!staff.businesses.some(bizId => bizId.toString() === business._id.toString())) {
        staff.businesses.push(business._id);
        const user = await User.findById(staff.userId).session(session);
        assignments.push({
          businessId: business._id,
          businessName: business.businessName,
          staffId: staff._id,
          staffName: user ? user.name : 'Unknown'
        });
      }

      // Move to next staff member in round-robin fashion
      staffIndex = (staffIndex + 1) % staffMembers.length;
    }

    // Save all staff members with updated business assignments
    await Promise.all(staffMembers.map(staff => staff.save({ session })));
    
    await session.commitTransaction();
    session.endSession();

    res.json({
      status: true,
      message: 'Businesses assigned to staff members successfully',
      data: {
        totalAssigned: assignments.length,
        assignments
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error auto-assigning businesses:', error);
    res.status(500).json({ 
      status: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
};

module.exports = { autoAssignBusinesses };
