const express = require('express');
const {createOrderHistory,updateOrderHistory,getOrderHistories,getOrderHistoryById,deleteOrderHistory,getOrderHistoriesAdmin} = require("../controllers//orderHistoryController");
const router = express.Router();

// Example route for fetching all packages
router.get('/getOrderHistories', getOrderHistories);
router.get('/getOrderHistoriesAdmin', getOrderHistoriesAdmin);
// Example route for creating a new package
router.post('/createOrderHistory',createOrderHistory );

// Example route for fetching a specific package by ID
router.get('/getOrderHistoryById',getOrderHistoryById);
router.delete('/deleteOrderHistory',deleteOrderHistory);
// Example route for updating a package by ID
router.put('/updateOrderHistory', updateOrderHistory);


module.exports = router;