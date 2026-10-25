const express = require('express');
const {createOrderHistory,updateOrderHistory,getOrderHistories,getOrderHistoryById,deleteOrderHistory,getOrderHistoriesAdmin} = require("../controllers//orderHistoryController");
const { authUser, adminOnly } = require('../middlewares/authMidd');
const asyncHandler = require('../utils/asyncHandler');
const router = express.Router();

// Example route for fetching all packages
router.get('/getOrderHistories', asyncHandler(authUser), getOrderHistories);
router.get('/getOrderHistoriesAdmin', adminOnly, getOrderHistoriesAdmin);
// Example route for creating a new package
router.post('/createOrderHistory', adminOnly, createOrderHistory );

// Example route for fetching a specific package by ID
router.get('/getOrderHistoryById', asyncHandler(authUser), getOrderHistoryById);
router.delete('/deleteOrderHistory', adminOnly, deleteOrderHistory);
// Example route for updating a package by ID
router.put('/updateOrderHistory', adminOnly, updateOrderHistory);


module.exports = router;