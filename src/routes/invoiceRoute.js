const express = require('express');
const { 
  getInvoiceDetails,
  getInvoiceByBusinessId,
  getInvoiceByBusinessIdByAdmin,
  getInvoiceByBusinessIdByAdmins,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getInvoiceHTML
} = require('../controllers/invoiceController');

const { authUser, adminOnly } = require('../middlewares/authMidd');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Get invoices
router.get('/invoices', asyncHandler(authUser), getInvoiceDetails);
router.get('/getInvoiceDetails', asyncHandler(authUser), getInvoiceDetails);
router.get('/getInvoiceDetails/:invoiceId', asyncHandler(authUser), getInvoiceDetails);
router.get('/getInvoiceByBusinessId', asyncHandler(authUser), getInvoiceByBusinessId);
router.get('/getInvoiceByBusinessIdByAdmin', adminOnly, getInvoiceByBusinessIdByAdmin);
router.get('/getInvoiceByBusinessIdByAdmins', adminOnly, getInvoiceByBusinessIdByAdmins);

// Dynamic Invoice Generation & Management
router.post('/createInvoice', adminOnly, createInvoice);
router.put('/updateInvoice/:id', adminOnly, updateInvoice);
router.delete('/deleteInvoice/:id', adminOnly, deleteInvoice);
// Opened from the app's browser/webview, which cannot send the login header; the invoice id is the key.
router.get('/getInvoiceHTML', getInvoiceHTML);

module.exports = router;