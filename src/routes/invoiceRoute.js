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

const router = express.Router();

// Get invoices
router.get('/invoices', getInvoiceDetails);
router.get('/getInvoiceDetails', getInvoiceDetails);
router.get('/getInvoiceDetails/:invoiceId', getInvoiceDetails);
router.get('/getInvoiceByBusinessId', getInvoiceByBusinessId);
router.get('/getInvoiceByBusinessIdByAdmin', getInvoiceByBusinessIdByAdmin);
router.get('/getInvoiceByBusinessIdByAdmins', getInvoiceByBusinessIdByAdmins);

// Dynamic Invoice Generation & Management
router.post('/createInvoice', createInvoice);
router.put('/updateInvoice/:id', updateInvoice);
router.delete('/deleteInvoice/:id', deleteInvoice);
router.get('/getInvoiceHTML', getInvoiceHTML);

module.exports = router;