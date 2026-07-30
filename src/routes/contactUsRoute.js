const express = require('express');
const { getAllContactUs, createContactUs } = require('../controllers/contactUsController');

const router = express.Router();

// Controller functions (you need to implement these)

// GET request to fetch contact us information
router.get('/getAllContactUs', getAllContactUs);

// POST request to submit contact us form
router.post('/createContactUs', createContactUs);

module.exports = router;