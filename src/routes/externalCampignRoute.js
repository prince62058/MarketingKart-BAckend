const express = require('express')
const controller = require('../controllers/externalCampiagnController')
const router = express.Router()

router.post('/campiagn/createCampiagns',controller.createCampaigns)

module.exports = router