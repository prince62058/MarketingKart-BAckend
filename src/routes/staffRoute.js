const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');

// Admin only routes
router.post('/',  staffController.addStaff);
router.get('/', staffController.getAllStaff);
router.get('/:staffId', staffController.getStaff);
router.put('/:staffId', staffController.updateStaff);
router.delete('/:staffId', staffController.deleteStaff);
router.get('/:staffId/businesses', staffController.getStaffBusinesses);

module.exports = router;
