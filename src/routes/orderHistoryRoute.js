const express = require('express');
const {createOrderHistory,updateOrderHistory,getOrderHistories,getOrderHistoryById,deleteOrderHistory,getOrderHistoriesAdmin} = require("../controllers//orderHistoryController");
const { authUser, adminOnly } = require('../middlewares/authMidd');
const { requirePermission } = require("../middlewares/adminPermission");
const asyncHandler = require('../utils/asyncHandler');
const router = express.Router();

// Example route for fetching all packages
router.get('/getOrderHistories', asyncHandler(authUser), getOrderHistories);
router.get('/getOrderHistoriesAdmin', adminOnly, requirePermission("ORDER_HISTORY"), getOrderHistoriesAdmin);
// Example route for creating a new package
router.post('/createOrderHistory', adminOnly, requirePermission("ORDER_HISTORY"), createOrderHistory );

// Example route for fetching a specific package by ID
router.get('/getOrderHistoryById', asyncHandler(authUser), getOrderHistoryById);
router.delete('/deleteOrderHistory', adminOnly, requirePermission("ORDER_HISTORY"), deleteOrderHistory);
// Example route for updating a package by ID
router.put('/updateOrderHistory', adminOnly, requirePermission("ORDER_HISTORY"), updateOrderHistory);


module.exports = router;