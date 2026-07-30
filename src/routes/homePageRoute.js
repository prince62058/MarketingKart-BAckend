const express = require("express");
const {
  homePage,
  getHome,
  updateHomePageAndUnlinkImage,
} = require("../controllers/homePageController");
const { upload } = require("../middlewares/multer");
const router = express.Router();

// Define the home page route
router.get("/homePage",homePage);
router.get("/getHome",getHome);
router.put("/updateHomePageAndUnlinkImage",  upload.fields([
  { name: "image" },
  { name: "icon" },
	{name:"banner"}
]),updateHomePageAndUnlinkImage);

module.exports = router;
