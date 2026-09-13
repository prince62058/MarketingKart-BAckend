const express = require('express');
const { 
  getAllContactUs, 
  createContactUs,
  deleteContactUs,
  updateContactStatus,
  updateContactUs 
} = require('../controllers/contactUsController');

const router = express.Router();

// GET request to fetch contact us information
router.get('/getAllContactUs', getAllContactUs);

// POST request to submit contact us form
router.post('/createContactUs', createContactUs);

// DELETE request to delete contact submission
router.delete('/deleteContactUs/:id', deleteContactUs);

// PUT request to update status of contact submission
router.put('/updateContactStatus/:id', updateContactStatus);

// PUT request to fully edit contact submission
router.put('/updateContactUs/:id', updateContactUs);

module.exports = router;