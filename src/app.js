const express = require("express");
const userRoutes = require("./routes/userRoute");
const advertisementRoutes = require("./routes/advertisementRoutes");
const businessCategoryRoute = require("./routes/businessCategoryRoute");
const businessRoute = require("./routes/businessRoute");
const cityRoute = require("./routes/cityRoute");
const countryRoute = require("./routes/countryRoute");
const planRoute = require("./routes/planRoute");
const stateRoute = require("./routes/stateRoute");
const campiagnRoute = require("./routes/externalCampignRoute");
const adsDetailsRoute = require("./routes/adsDetailsRoute");
const offeringsRoute = require("./routes/offeringsRoute");
const aiImagePlan = require("./routes/aiImagePlanRoute");
const internalCampaignRoute = require("./routes/internalCampiagnRoute");
const webhookRoute = require("./routes/webhookRoute");
const leadHistoryRoute = require("./routes/leadHistoryChangeRoute");
// const userRoleRoute = require('./routes/permissionRoute')
const ImageBusinessRoute = require("./routes/ImageBusinessRoute");
const imageCategoryRoute = require("./routes/imageCategoryRoute");
const faqRoute = require("./routes/faqRoute");
const videoYoutubeRoute = require("./routes/videoYoutubeRoute");
const companyRoute = require("./routes/companyRoute");
const videoRoute = require("./routes/videoRoute");
const phonePayRoute = require("./routes/phonePayRoute");
const adminDashboard = require("./routes/adminDashboard");
const recentAdsDesignRoute = require("./routes/recentAdsDesignsRoute");
const notificationRoute = require("./routes/notificationRoute");
const homePageRoute = require("./routes/homePageRoute");
const contactUsRoute = require("./routes/contactUsRoute");
const callRequestRoute = require("./routes/callRequestRoute");
const invoiceRoute = require("./routes/invoiceRoute");
const transtionRoute = require("./routes/transtionRoute");
const { manageCampaigns } = require("./controllers/adsRunChecking");
const AdsChecking = require("./controllers/AdsChecking");
const packageRoute = require("./routes/packageRoute");
const GstOfUserRoute = require("./routes/GstOfUserRoute");
const manageCampaign = require("./controllers/LeadData");
const fowllowUpController = require("./controllers/fowllowUpController");
const userRoleRoute = require("./routes/userRoleRoute");
const rolePermissionRoute = require("./routes/rolePermissionRoute");
const simplevideoRoute = require("./routes/simplevideoRoute");
const ugcVideoRoute = require("./routes/ugcVideoRoute");
const vioceOverVideoRoute = require("./routes/vioceOverVideoRoute");
const orderHistoryRoute = require("./routes/orderHistoryRoute");
const staffRoute = require("./routes/staffRoute");
const maintenanceCheck = require("./middlewares/maintenanceCheck");
const cors = require("cors"); // Import cors
const path = require("path");
// const internalCampaignRoute = require('./routes/internalCampiagnRoute')

const errorMiddleware = require("./middlewares/errorMiddleware");

const app = express();

// Enable CORS for all routes
app.use(cors()); // Allows requests from all origins by default. You can configure specific origins if needed.

// Middleware for parsing JSON bodies
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.body,
  });
  next();
});
app.use(express.urlencoded({ extended: true }));

app.use(express.static("public")); // serve static files from 'public' folder

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html")); // serve index.html as default page
});

// Maintenance middleware (handles skipping internally)
app.use(maintenanceCheck);

// Routes

app.use("/api", userRoutes);
app.use("/api", invoiceRoute);
app.use("/api", advertisementRoutes);
app.use("/api", businessCategoryRoute);
app.use("/api", businessRoute);
app.use("/api", cityRoute);
app.use("/api", countryRoute);
app.use("/api", planRoute);
app.use("/api", stateRoute);
app.use("/api", campiagnRoute);
app.use("/api", adsDetailsRoute);
app.use("/api", offeringsRoute);
app.use("/api", aiImagePlan);
app.use("/api", internalCampaignRoute);
app.use("/api", webhookRoute);
app.use("/api", leadHistoryRoute);
// app.use('/api', userRoleRoute)
app.use("/api", ImageBusinessRoute);
app.use("/api", imageCategoryRoute);
app.use("/api", faqRoute);
app.use("/api", companyRoute);
app.use("/api", videoRoute);
app.use("/api", phonePayRoute);
app.use("/api", adminDashboard);
app.use("/api", notificationRoute);
app.use("/api", homePageRoute);
app.use("/api", contactUsRoute);
app.use("/api", callRequestRoute);
app.use("/api", transtionRoute);
app.use("/api", packageRoute);
app.use("/api", GstOfUserRoute);
app.use("/api", userRoleRoute);
app.use("/api", rolePermissionRoute);
app.use("/api", vioceOverVideoRoute);
app.use("/api", ugcVideoRoute);
app.use("/api", simplevideoRoute);
app.use("/api", orderHistoryRoute);
app.use("/api", videoYoutubeRoute);
// Error handling middleware
app.use("/api", recentAdsDesignRoute);
app.use("/api", staffRoute);
app.use("/api", require("./routes/whatsappRoute"));
app.use("/api/premium-plan", require("./routes/premiumPlanRoute"));
app.use("/api", require("./routes/whatsappWalletRoute"));
app.use("/api", require("./routes/whatsappSupportRoute"));
app.use("/api/whatsapp/chat", require("./routes/whatsappChatRoute"));
app.use(errorMiddleware);
module.exports = app;
