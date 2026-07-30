const express = require('express');
const router = express.Router();
const { autoAssignBusinesses } = require('../controllers/autoAssignController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user.role === 1) { // Assuming 1 is admin role
    next();
  } else {
    res.status(403).json({ status: false, message: 'Access denied. Admin only.' });
  }
};

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Auto-assign businesses to staff members
router.post('/auto-assign', isAdmin, autoAssignBusinesses);

module.exports = router;
