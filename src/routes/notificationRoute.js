const express = require('express');

const router = express.Router();
const {
    sendNotificationToAllUsersBusiness,
    sendNotificationToBusinessUsers,
    getNotificationsByUserIdBusinessId,
    getUnreadNotificationsCount,
    sendNotificationToAllUsersWithCondition,
    sendNotificationToSingleUserAndBusiness
} = require('../controllers/notificationController');
const { upload } = require('../middlewares/multer');

// Route to send notification to all users
router.post('/send-to-all-users',upload.single("image") ,sendNotificationToAllUsersBusiness);
router.post('/sendNotificationToSingleUserAndBusiness',upload.single("image"),sendNotificationToSingleUserAndBusiness);
// Route to send notification to users of a specific business
router.post('/send-to-business-users', upload.single("image") ,sendNotificationToBusinessUsers);

// Route to get notifications by userId and businessId (optional)
router.get('/get-notifications', getNotificationsByUserIdBusinessId);

// Route to get unread notifications count by businessId and userId (optional)
router.get('/unread-count', getUnreadNotificationsCount);

// Route to send notification to all users with condition
router.post('/send-to-all-users-with-condition',upload.single("image") , sendNotificationToAllUsersWithCondition);

module.exports = router;