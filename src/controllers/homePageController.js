const HomePage = require("../models/homepageModel");
const advertisementModel = require("../models/advertisementModel");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");

// Get Home Page
exports.getHome = async (req, res) => {
  try {
    const homePage = await HomePage.findOne();
    res.status(200).json({
      success: true,
      data: {
        homePage,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message,
    });
  }
};

// Get Home Page
exports.homePage = async (req, res) => {
  try {
    const { disable } = req.query;
    const homePage = await HomePage.findOne();
    let advertisement = await advertisementModel.find({ disable: disable });
    
    // Sort logic: Move WhatsApp ads to the top
    const whatsappIndex = advertisement.findIndex(item => 
      item.title && item.title.toLowerCase().includes('whatsapp')
    );
    if (whatsappIndex > -1) {
      const [whatsappItem] = advertisement.splice(whatsappIndex, 1);
      advertisement.unshift(whatsappItem);
    }

    res.status(200).json({
      success: true,
      data: {
        homePage,
        advertisement,
      },
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err.message,
    });
  }
};
// Update Home Page and Unlink Image
exports.updateHomePageAndUnlinkImage = async (req, res) => {
  try {
    const homePage = await HomePage.findById(req.query.homeId);

    if (!homePage) {
      return res.status(404).json({
        success: false,
        message: "No document found with that ID",
      });
    }

    const { Title, title, subTitle, contactNumber, index } = req.body;

    // Update images index-wise
    if (req.files?.image?.length > 0) {
      req.files.image.forEach((file) => {
        // Unlink the existing image if it exists
        if (homePage.image[index]?.image) {
          deleteFileFromObjectStorage(homePage.image[index].image);
        }
        // Update the new image URL
        if (!homePage.image[index]) {
          homePage.image[index] = {}; // Ensure the index exists
        }
        homePage.image[index].image = file.location;
      });
    }

    // Update icons index-wise
    if (req.files?.icon?.length > 0) {
      req.files.icon.forEach((file) => {
        // Unlink the existing icon if it exists
        if (homePage.image[index]?.icon) {
          deleteFileFromObjectStorage(homePage.image[index].icon);
        }
        // Update the new icon URL
        if (!homePage.image[index]) {
          homePage.image[index] = {}; // Ensure the index exists
        }
        homePage.image[index].icon = file.location;
      });
    }

    // Update Titles index-wise
    if (Title?.length > 0) {
      Title.forEach((t) => {
        if (!homePage.image[index]) {
          homePage.image[index] = {}; // Ensure the index exists
        }
        homePage.image[index].Title = t;
      });
    }

    // Update other fields
    homePage.title = title;
    homePage.subTitle = subTitle;
    homePage.contactNumber = contactNumber;

    // Update banner if provided
    if (req.files?.banner?.length > 0) {
      // Unlink the existing banner
      if (homePage.banner) {
        deleteFileFromObjectStorage(homePage.banner);
      }
      homePage.banner = req.files.banner[0].location;
    }

    // Save the updated document
    await homePage.save();

    return res.status(200).json({
      success: true,
      message: "Home Page updated successfully",
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message,
    });
  }
};
