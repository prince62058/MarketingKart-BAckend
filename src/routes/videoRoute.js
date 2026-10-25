const express = require('express')
const router = express.Router()
const controller = require('../controllers/videoController')
const { adminOnly } = require('../middlewares/authMidd')

router.post('/createVideo',adminOnly,controller.createVideo)
router.get('/getVideos',controller.getAllVideos)
router.put('/updateVideo',adminOnly,controller.updateVideo)
router.delete("/deleteVideo",adminOnly,controller.deleteVideo)

module.exports = router;