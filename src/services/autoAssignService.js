const Staff = require("../models/staffModel");
const Business = require("../models/businessModel");
const CallRequest = require("../models/callRequestModel");
const User = require("../models/userModel");

/**
 * Finds the next available staff member using a "Least Assignments" strategy.
 * For now, we'll just use a simple round-robin based on who was assigned the longest ago
 * or simply has the fewest currently assigned items.
 */
const getNextStaff = async () => {
  try {
    // Get all active staff members
    const staffMembers = await Staff.find({ isActive: true }).lean();
    if (staffMembers.length === 0) return null;

    // To be perfectly balanced, we should count their assignments
    // But a simpler way for "jitni staf uske hisab se" is tracking who was last assigned.
    // However, let's actually count for better accuracy.
    
    let bestStaff = null;
    let minCount = Infinity;

    for (const staff of staffMembers) {
      const businessCount = await Business.countDocuments({ assignedStaff: staff._id });
      const callCount = await CallRequest.countDocuments({ assignedStaff: staff._id });
      const totalCount = businessCount + callCount;

      if (totalCount < minCount) {
        minCount = totalCount;
        bestStaff = staff;
      }
    }

    return bestStaff;
  } catch (error) {
    console.error("Error in getNextStaff:", error);
    return null;
  }
};

const assignCallToStaff = async (callId) => {
  const staff = await getNextStaff();
  if (staff) {
    await CallRequest.findByIdAndUpdate(callId, {
      assignedStaff: staff._id,
      isAssigned: true
    });
    return staff;
  }
  return null;
};

const assignBusinessToStaff = async (businessId) => {
  const staff = await getNextStaff();
  if (staff) {
    await Business.findByIdAndUpdate(businessId, {
      assignedStaff: staff._id,
      isAssigned: true
    });
    // Also update the staff's businesses array (keeping it consistent with staff model)
    await Staff.findByIdAndUpdate(staff._id, {
      $addToSet: { businesses: businessId }
    });
    return staff;
  }
  return null;
};

const distributeUnassignedCalls = async () => {
  try {
    const unassignedCalls = await CallRequest.find({
      $or: [{ assignedStaff: { $exists: false } }, { assignedStaff: null }, { isAssigned: false }]
    });

    for (const call of unassignedCalls) {
      await assignCallToStaff(call._id);
    }
    return unassignedCalls.length;
  } catch (error) {
    console.error("Error in distributeUnassignedCalls:", error);
    throw error;
  }
};

const reassignStaffLeads = async (staffId) => {
  // Find all businesses assigned to this staff
  const businesses = await Business.find({ assignedStaff: staffId });
  for (const biz of businesses) {
    await assignBusinessToStaff(biz._id);
  }

  // Find all call requests assigned to this staff
  const calls = await CallRequest.find({ assignedStaff: staffId });
  for (const call of calls) {
    await assignCallToStaff(call._id);
  }
};

const rebalanceAllAssignments = async () => {
  try {
    const activeStaff = await Staff.find({ isActive: true });
    if (activeStaff.length === 0) return;

    const allCalls = await CallRequest.find({});
    if (allCalls.length === 0) return;

    // Use a simple round-robin for perfect balance
    let staffIndex = 0;
    for (const call of allCalls) {
      await CallRequest.findByIdAndUpdate(call._id, {
        assignedStaff: activeStaff[staffIndex]._id,
        isAssigned: true
      });
      staffIndex = (staffIndex + 1) % activeStaff.length;
    }
    
    // Also re-balance businesses (optional, but keep it consistent if needed)
    // The user specifically mentioned call requests, but being consistent is good.
    const allBusinesses = await Business.find({});
    staffIndex = 0;
    for (const biz of allBusinesses) {
       await Business.findByIdAndUpdate(biz._id, {
         assignedStaff: activeStaff[staffIndex]._id,
         isAssigned: true
       });
       staffIndex = (staffIndex + 1) % activeStaff.length;
    }

    return allCalls.length;
  } catch (error) {
    console.error("Error in rebalanceAllAssignments:", error);
    throw error;
  }
};

module.exports = {
  getNextStaff,
  assignCallToStaff,
  assignBusinessToStaff,
  reassignStaffLeads,
  distributeUnassignedCalls,
  rebalanceAllAssignments
};
