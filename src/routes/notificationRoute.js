const express = require('express');

const router = express.Router();
const {
    sendNotificationToAllUsersBusiness,
    sendNotificationToBusinessUsers,
    getNotificationsByUserIdBusinessId,
    getUnreadNotificationsCount,
    markNotificationAsRead,
    clearNotifications,
    sendNotificationToAllUsersWithCondition,
    sendNotificationToSingleUserAndBusiness
} = require('../controllers/notificationController');
const { upload } = require('../middlewares/multer');
const { authUser, adminOnly } = require('../middlewares/authMidd');
const asyncHandler = require('../utils/asyncHandler');

// Route to send notification to all users
router.post('/send-to-all-users',adminOnly,upload.single("image") ,sendNotificationToAllUsersBusiness);
router.post('/sendNotificationToSingleUserAndBusiness',adminOnly,upload.single("image"),sendNotificationToSingleUserAndBusiness);
// Route to send notification to users of a specific business
router.post('/send-to-business-users', adminOnly, upload.single("image") ,sendNotificationToBusinessUsers);

// Route to get notifications by userId and businessId (optional)
router.get('/get-notifications', asyncHandler(authUser), getNotificationsByUserIdBusinessId);

// Route to get unread notifications count by businessId and userId (optional)
router.get('/unread-count', asyncHandler(authUser), getUnreadNotificationsCount);

// Route to mark notifications as read
router.put('/mark-as-read', asyncHandler(authUser), markNotificationAsRead);

// Route to clear notifications
router.delete('/clear-notifications', asyncHandler(authUser), clearNotifications);

// Route to send notification to all users with condition
router.post('/send-to-all-users-with-condition',adminOnly,upload.single("image") , sendNotificationToAllUsersWithCondition);

module.exports = router;