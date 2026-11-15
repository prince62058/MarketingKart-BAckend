const express = require('express')
const controller = require('../controllers/externalCampiagnController')
const { adminOnly } = require('../middlewares/authMidd')
const router = express.Router()

router.post('/campiagn/createCampiagns',adminOnly,controller.createCampaigns)

module.exports = router