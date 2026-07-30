const express = require('express')
const router = express.Router()
const controller = require('../controllers/videoController')
const {upload} = require('../middlewares/multer')

router.post('/createVideo',upload.fields([{name:'videoUrl'},{name:'thumbnail'}]),controller.createVideo)
router.delete("/deleteVideo",controller.deleteVideo)

module.exports = router;