const express = require('express');
const { 
  getAllContactUs, 
  createContactUs,
  deleteContactUs,
  updateContactStatus,
  updateContactUs 
} = require('../controllers/contactUsController');

const { adminOnly } = require('../middlewares/authMidd');

const router = express.Router();

// GET request to fetch contact us information
router.get('/getAllContactUs', adminOnly, getAllContactUs);

// POST request to submit contact us form
router.post('/createContactUs', createContactUs);

// DELETE request to delete contact submission
router.delete('/deleteContactUs/:id', adminOnly, deleteContactUs);

// PUT request to update status of contact submission
router.put('/updateContactStatus/:id', adminOnly, updateContactStatus);

// PUT request to fully edit contact submission
router.put('/updateContactUs/:id', adminOnly, updateContactUs);

module.exports = router;