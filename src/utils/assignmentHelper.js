const Staff = require("../models/staffModel");
const Business = require("../models/businessModel");

/**
 * Assigns a business to an active staff member with the minimum workload.
 * @returns {Promise<string|null>} The ID of the assigned staff member or null if none available.
 */
const getBestStaffForBusiness = async () => {
  try {
    // Find all active staff members
    const eligibleStaff = await Staff.find({ isActive: true });

    if (eligibleStaff.length === 0) {
      return null;
    }

    // Get workload (count of assigned businesses) for each eligible staff
    const workloads = await Promise.all(
      eligibleStaff.map(async (staff) => {
        const count = await Business.countDocuments({
          assignedStaff: staff._id,
          disable: false, // Only count active businesses
          status: { $ne: 'Completed' } // Only count active/pending leads
        });
        return { staffId: staff._id, count };
      })
    );

    // Find staff with minimum workload
    const bestStaff = workloads.reduce((prev, curr) => 
      (prev.count <= curr.count) ? prev : curr
    );

    return bestStaff.staffId;
  } catch (error) {
    console.error("Error in getBestStaffForBusiness:", error);
    return null;
  }
};

/**
 * Assigns all businesses that are currently unassigned to active staff members.
 */
const assignAllUnassignedBusinesses = async () => {
  try {
    const unassignedBusinesses = await Business.find({ 
      assignedStaff: null,
      disable: false 
    });

    if (unassignedBusinesses.length === 0) {
      console.log("No unassigned businesses found.");
      return;
    }

    for (const business of unassignedBusinesses) {
      const staffId = await getBestStaffForBusiness();
      if (staffId) {
        await Business.findByIdAndUpdate(business._id, {
          assignedStaff: staffId,
          isAssigned: true
        });
        
        // Also update the Staff model if needed (the staff model has a 'businesses' array)
        await Staff.findByIdAndUpdate(staffId, {
          $addToSet: { businesses: business._id }
        });
      }
    }
    console.log(`Successfully assigned ${unassignedBusinesses.length} businesses.`);
  } catch (error) {
    console.error("Error in assignAllUnassignedBusinesses:", error);
  }
};

module.exports = {
  getBestStaffForBusiness,
  assignAllUnassignedBusinesses
};
