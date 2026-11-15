const express = require('express')
const router = express.Router()
const controller = require('../controllers/recentAdsDesignController')
const {upload} = require('../middlewares/multer')
const { adminOnly } = require('../middlewares/authMidd')

router.post('/createAds',  
adminOnly,
upload.single("img")
,controller.createAds)

router.put('/updateAds',  
    adminOnly,
    upload.single("img")
    ,controller.updateAds)

router.get("/getAds",controller.getAds)
router.get("/getAllAds",controller.getAllAds)


router.delete("/deleteAds",adminOnly,controller.deleteAds)

module.exports = router;