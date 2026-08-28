const express = require('express')
const router = express.Router()
const controller = require('../controllers/videoController')

router.post('/createVideo',controller.createVideo)
router.get('/getVideos',controller.getAllVideos)
router.put('/updateVideo',controller.updateVideo)
router.delete("/deleteVideo",controller.deleteVideo)

module.exports = router;