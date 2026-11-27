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
const { requirePermission } = require("../middlewares/adminPermission");
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Get invoices
router.get('/invoices', asyncHandler(authUser), getInvoiceDetails);
router.get('/getInvoiceDetails', asyncHandler(authUser), getInvoiceDetails);
router.get('/getInvoiceDetails/:invoiceId', asyncHandler(authUser), getInvoiceDetails);
router.get('/getInvoiceByBusinessId', asyncHandler(authUser), getInvoiceByBusinessId);
router.get('/getInvoiceByBusinessIdByAdmin', adminOnly, requirePermission("INVOICE"), getInvoiceByBusinessIdByAdmin);
router.get('/getInvoiceByBusinessIdByAdmins', adminOnly, requirePermission("INVOICE"), getInvoiceByBusinessIdByAdmins);

// Dynamic Invoice Generation & Management
router.post('/createInvoice', adminOnly, requirePermission("INVOICE"), createInvoice);
router.put('/updateInvoice/:id', adminOnly, requirePermission("INVOICE"), updateInvoice);
router.delete('/deleteInvoice/:id', adminOnly, requirePermission("INVOICE"), deleteInvoice);
router.get('/invoice-templates', adminOnly, requirePermission("INVOICE"), listInvoiceTemplates);
router.post('/invoice-templates', adminOnly, requirePermission("INVOICE"), createInvoiceTemplate);
router.put('/invoice-templates/:id', adminOnly, requirePermission("INVOICE"), updateInvoiceTemplate);
router.delete('/invoice-templates/:id', adminOnly, requirePermission("INVOICE"), deleteInvoiceTemplate);
router.get('/invoice-template-preview', adminOnly, requirePermission("INVOICE"), previewInvoiceTemplate);
// Opened from the app's browser/webview, which cannot send the login header; the invoice id is the key.
router.get('/getInvoiceHTML', require('../middlewares/rateLimit').limits.invoiceLink, getInvoiceHTML);

module.exports = router;