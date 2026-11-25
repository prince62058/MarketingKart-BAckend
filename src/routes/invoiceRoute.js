const express = require('express');
const { 
  getInvoiceDetails,
  getInvoiceByBusinessId,
  getInvoiceByBusinessIdByAdmin,
  getInvoiceByBusinessIdByAdmins,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  getInvoiceHTML,
  previewInvoiceTemplate,
} = require('../controllers/invoiceController');
const {
  listInvoiceTemplates,
  createInvoiceTemplate,
  updateInvoiceTemplate,
  deleteInvoiceTemplate,
} = require('../controllers/invoiceTemplate.controller');

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
router.get('/invoice-templates', adminOnly, listInvoiceTemplates);
router.post('/invoice-templates', adminOnly, createInvoiceTemplate);
router.put('/invoice-templates/:id', adminOnly, updateInvoiceTemplate);
router.delete('/invoice-templates/:id', adminOnly, deleteInvoiceTemplate);
router.get('/invoice-template-preview', adminOnly, previewInvoiceTemplate);
// Opened from the app's browser/webview, which cannot send the login header; the invoice id is the key.
router.get('/getInvoiceHTML', getInvoiceHTML);

module.exports = router;