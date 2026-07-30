const express = require('express');
const { getInvoiceDetails,getInvoiceByBusinessId,getInvoiceByBusinessIdByAdmin,getInvoiceByBusinessIdByAdmins } = require('../controllers/invoiceController');

const router = express.Router();

// Example route to get all invoices
router.get('/invoices', getInvoiceDetails);

// Example route to create a new invoice
router.get('/getInvoiceByBusinessId',getInvoiceByBusinessId );

router.get('/getInvoiceByBusinessIdByAdmin',getInvoiceByBusinessIdByAdmin );
router.get('/getInvoiceByBusinessIdByAdmins',getInvoiceByBusinessIdByAdmins );
module.exports = router;