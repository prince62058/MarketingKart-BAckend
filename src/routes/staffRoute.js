const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const { adminOnly } = require('../middlewares/authMidd');
const { requirePermission } = require('../middlewares/adminPermission');

// Admin only routes. Reading the list is open to every admin (the call-request page assigns staff);
// creating, changing and removing staff needs the STAFF permission, or a limited staff member could
// make themselves an admin.
const manageStaff = [adminOnly, requirePermission('STAFF')];
router.post('/', manageStaff, staffController.addStaff);
router.get('/', adminOnly, staffController.getAllStaff);
router.get('/:staffId', adminOnly, staffController.getStaff);
router.put('/:staffId', manageStaff, staffController.updateStaff);
router.delete('/:staffId', manageStaff, staffController.deleteStaff);
router.get('/:staffId/businesses', adminOnly, staffController.getStaffBusinesses);

module.exports = router;
