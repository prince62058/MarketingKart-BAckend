const express = require('express')
const router = express.Router()
const controller = require('../controllers/recentAdsDesignController')
const {upload} = require('../middlewares/multer')

router.post('/createAds',  
upload.single("img")
,controller.createAds)

router.put('/updateAds',  
    upload.single("img")
    ,controller.updateAds)

router.get("/getAds",controller.getAds)
router.get("/getAllAds",controller.getAllAds)


router.delete("/deleteAds",controller.deleteAds)

module.exports = router;