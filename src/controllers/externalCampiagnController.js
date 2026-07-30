// const {
//   statusCodes,
//   defaultResponseMessage,
//   apiResponseStatusCode,
// } = require("../Message/defaultMessage");
// const campaignsServices = require("../services/externalCampaignsServices");
// const responseBuilder = require("../utils/responseBuilder");
// const axios = require("axios");
// // const campaignModel = require("../models/ExternalCampaignsModel");
// const businessModel = require("../models/businessModel");
// const ExternalCampaignsModel = require("../models/ExternalCampaignsModel");

// exports.createCampaigns = async (req, res) => {
//   try {
//     let {
//       name,
//       objective,
//       status,
//       businessId,
//       pageId,
//       pageAccessToken,
//       metaAccessToken,
//     } = req.body;
//     if (!businessId) {
//       return res
//         .status(400)
//         .send({ success: false, message: "businessId is required" });
//     }
//     if (!pageId) {
//       return res
//         .status(400)
//         .send({ success: false, message: "pageId is required" });
//     }
//     if (!pageAccessToken) {
//       return res
//         .status(400)
//         .send({ success: false, message: "pageAccessToken is required" });
//     }
//     if (!metaAccessToken) {
//       return res
//         .status(400)
//         .send({ success: false, message: "metaAccessToken is required" });
//     }
//     var check = null;
//     if (pageId && pageAccessToken && metaAccessToken) {
//       const accessToken = pageAccessToken;
//       const page = pageId;

//       let response = await fetch(
//         `https://graph.facebook.com/v21.0/${page}/subscribed_apps?access_token=${accessToken}`
//       );
//       let data = await response.json();
//       check = data?.data;
//     }

//     let businessData;
//     if (check) {
//       businessData = await businessModel.findByIdAndUpdate(
//         { _id: businessId },
//         { $set: { pageId, pageAccessToken, metaAccessToken } },
//         { new: true }
//       );
//     } else {
//       return res.status(statusCodes["Bad Request"]).json(
//         responseBuilder(
//           apiResponseStatusCode[400],
//           "something is wrong"
//           // businessData
//         )
//       );
//     }
//     let find = await ExternalCampaignsModel.findOne({ businessId: businessId });
//     if (!find) {
//       const apiUrl =
//         "https://graph.facebook.com/v21.0/act_1146486499874814/campaigns";

//       let response = await axios.post(apiUrl, {
//         name: name,
//         objective: objective,
//         access_token: businessData?.metaAccessToken,
//         status: status,
//         special_ad_categories: [],
//       });
//       await campaignsServices.createCampaign({
//         meta_CampaignId: response.data.id,
//         name: name,
//         objective: objective,
//         status: status,
//         businessId: businessId,
//       });
//     }
//     return res
//       .status(statusCodes.Created)
//       .json(
//         responseBuilder(
//           apiResponseStatusCode[200],
//           defaultResponseMessage?.UPDATED,
//           businessData
//         )
//       );
//   } catch (error) {
//     return res.status(500).send({ success: false, message: error.message });
//   }
// };


const {
  statusCodes,
  defaultResponseMessage,
  apiResponseStatusCode,
} = require("../Message/defaultMessage");
const campaignsServices = require("../services/externalCampaignsServices");
const responseBuilder = require("../utils/responseBuilder");
const axios = require("axios");
// const campaignModel = require("../models/ExternalCampaignsModel");
const businessModel = require("../models/businessModel");
const ExternalCampaignsModel = require("../models/ExternalCampaignsModel");

async function fetchData() {
  if (pageId && pageAccessToken && metaAccessToken) {
    const accessToken = pageAccessToken;
    const page = pageId;

    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${page}/subscribed_apps?access_token=${accessToken}`
      );
      const data = await response.json();
      console.log(data.data);
      const check = data;
      // updateBusiness._doc.data = data;  // Uncomment this line if you need to use the data
      console.log(check, "check");
      return check;
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }
}

exports.createCampaigns = async (req, res) => {
  try {
    let {
      name,
      objective,
      status,
      businessId,
      pageId,
      pageAccessToken,
      metaAccessToken,
    } = req.body;
    if (!businessId) {
      return res
        .status(400)
        .send({ success: false, message: "businessId is required" });
    }
    if (!pageId) {
      return res
        .status(400)
        .send({ success: false, message: "pageId is required" });
    }
    if (!pageAccessToken) {
      return res
        .status(400)
        .send({ success: false, message: "pageAccessToken is required" });
    }
    if (!metaAccessToken) {
      return res
        .status(400)
        .send({ success: false, message: "metaAccessToken is required" });
    }
    var check;
    if (pageId && pageAccessToken && metaAccessToken) {
      const accessToken = pageAccessToken;
      const page = pageId;

      let response = await fetch(
        `https://graph.facebook.com/v21.0/${page}/subscribed_apps?access_token=${accessToken}`
      );
      // console.log("response",response)
      let data = await response.json();
      check = data?.data;
    }
    let fb_exchange_token = metaAccessToken;
    let fb_exchange_token1 = pageAccessToken;
    let client_id = "1569095363786954";
    let client_secret = "0dd5ddd645af8441f5bc2aeca97d8997";
    let grant_type = "fb_exchange_token";
    let response = await fetch(
      `https://graph.facebook.com/oauth/access_token?client_id=${client_id}&client_secret=${client_secret}&grant_type=${grant_type}&fb_exchange_token=${fb_exchange_token}`
    );
    let data = await response.json();
    let response1 = await fetch(
      `https://graph.facebook.com/oauth/access_token?client_id=${client_id}&client_secret=${client_secret}&grant_type=${grant_type}&fb_exchange_token=${fb_exchange_token1}`
    );
    let data1 = await response1.json();
    // check = data?.data;
    let businessData;
    if (check) {
      businessData = await businessModel.findByIdAndUpdate(
        { _id: businessId },
        {
          $set: {
            pageId,
            pageAccessToken: data1?.access_token,
            metaAccessToken: data?.access_token,
          },
        },
        { new: true }
      );
    } else {
      return res.status(statusCodes["Bad Request"]).json(
        responseBuilder(
          apiResponseStatusCode[400],
          "something is wrong"
          // businessData
        )
      );
    }
    let find = await ExternalCampaignsModel.findOne({ businessId: businessId });
    if (!find) {
      const apiUrl =
        "https://graph.facebook.com/v21.0/act_1146486499874814/campaigns";

      let response = await axios.post(apiUrl, {
        name: name,
        objective: objective,
        access_token: businessData?.metaAccessToken,
        status: status,
        special_ad_categories: [],
      });
      await campaignsServices.createCampaign({
        meta_CampaignId: response.data.id,
        name: name,
        objective: objective,
        status: status,
        businessId: businessId,
      });
    }

    
    return res
      .status(statusCodes.Created)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage?.UPDATED,
          businessData
        )
      );
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};
