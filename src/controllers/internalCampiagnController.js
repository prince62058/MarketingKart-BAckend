// const {
//   statusCodes,
//   defaultResponseMessage,
//   apiResponseStatusCode,
// } = require("../Message/defaultMessage");
// const campaignsServices = require("../services/internalCampaignService");
// const responseBuilder = require("../utils/responseBuilder");
// const internalCampiagnModel = require("../models/internalCampiagnModel");

// exports.createInternalCampiagn = async (req, res) => {
//   try {
//     const {
//       creativeId,
//       businessId,
//       externalCampiagnId,
//       title,
//       imageId,
//       caption,
//       callToActionId,
//       destinationUrl,
//       audienceId,
//       interest,
//       location,
//       audienceGender,
//       ageRangeFrom,
//       ageRangeTo,
//       days,
//       planId,
//       facebookBudget,
//       instaBudget,
//       googleBudget,
//       facebookBalance,
//       instaBalance,
//       googleBalance,
      
//       transactionId,
//       metaAdId,
//       googleAdId,
//       dailySpendLimit,
//       balanceAmount,
//       endDate,
//       dayStartTime,
//       dayEndTime,
//       isFacebookAdEnabled,
//       isInstaAdEnabled,
//       isGoogleAdEnabledokAdSetId,
//       instaAdSetId,
//       googleAdSetId,
//     } = req.body;
//     if (!businessId) {
//       return res
//         .status(400)
//         .send({ success: false, message: "businessId is required" });
//     }
//     let businessData = await internalCampiagnModel.findOne({
//       businessId: businessId,
//     });
//     if (businessData) {
//       return res
//         .status(400)
//         .send({
//           success: false,
//           message: "already internal campiagn create from this business",
//         });
//     }
//     const data = await campaignsServices.createCampaign({
//       creativeId,
//       businessId,
//       externalCampiagnId,
//       title,
//       imageId,
//       caption,
//       callToActionId,
//       destinationUrl,
//       audienceId,
//       interest,
//       location,
//       audienceGender,
//       ageRangeFrom,
//       ageRangeTo,
//       days,
//       planId,
//       facebookBudget,
//       instaBudget,
//       googleBudget,
//       facebookBalance,
//       instaBalance,
//       googleBalance,
//       totalAmount,
//       transactionId,
//       metaAdId,
//       googleAdId,
//       dailySpendLimit,
//       balanceAmount,
//       endDate,
//       dayStartTime,
//       dayEndTime,
//       isFacebookAdEnabled,
//       isInstaAdEnabled,
//       isGoogleAdEnabledokAdSetId,
//       instaAdSetId,
//       googleAdSetId,
//       facebookAdSetId,
//     });
//     return res
//       .status(statusCodes.Created)
//       .json(
//         responseBuilder(
//           apiResponseStatusCode[201],
//           defaultResponseMessage?.CREATED,
//           data
//         )
//       );
//   } catch (error) {
//     return res
//       .status(statusCodes["Internal Server Error"])
//       .send({ success: false, message: error.message });
//   }
// };
