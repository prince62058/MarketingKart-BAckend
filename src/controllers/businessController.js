const {
  statusCodes,
  defaultResponseMessage,
  apiResponseStatusCode,
} = require("../Message/defaultMessage");
const { deleteFileFromObjectStorage } = require("../middlewares/multer");
const businessService = require("../services/businessService");
const userService = require("../services/userService");
const responseBuilder = require("../utils/responseBuilder");
const axios = require("axios");
const permissionModel = require("../models/permissionModel");
require("../models/staffModel"); // Added to fix Schema hasn't been registered for model "staff" error
const businessModel = require("../models/businessModel");
const { assignBusinessToStaff } = require("../services/autoAssignService");
const internalCampaignModel = require("../models/internalCampiagnModel");
const { uploadUrlToBucket } = require("../utils/bucketHelper");

exports.createBusiness = async (req, res) => {
  const {
    businessName,
    userId,
    businessCategoryId,
    servicesId,
    businessContact,
    whatsappNumber,
    stateId,
    cityId,
    countryId,
    websiteLink,
    businessEmail,
    instagramLink,
    twitterLink,
    youtubeLink,
    facebookLink,
    address,
    tagline,
  } = req.body;

  if (!businessName) {
    return res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(apiResponseStatusCode[400], "businessName is required"),
      );
  }

  if (!userId) {
    return res
      .status(statusCodes["Bad Request"])
      .json(responseBuilder(apiResponseStatusCode[400], "userId is required"));
  }

  if (!businessCategoryId) {
    return res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          "businessCategoryId is required",
        ),
      );
  }

  if (!servicesId) {
    return res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(apiResponseStatusCode[400], "servicesId is required"),
      );
  }

  await userService.updateUser(userId, { roleId: "66ae0d19a1432b1bddd15b0f" });

  let dataObj = {
    businessName,
    userId,
    businessCategoryId,
    servicesId,
    businessContact,
    whatsappNumber,
    stateId,
    cityId,
    countryId,
    websiteLink,
    instagramLink,
    twitterLink,
    youtubeLink,
    facebookLink,
    address,
    businessEmail,
    tagline,
    businessImage: req.file?.location,
  };
  const createData = await businessService.createBusiness(dataObj);

  // Auto assignment
  // await assignBusinessToStaff(createData._id);

  await permissionModel.create({
    businessId: createData._id,
    userId: userId,
    accessLevel: "ADMIN",
    permissions: [],
  });

  return res
    .status(statusCodes.Created)
    .json(
      responseBuilder(
        apiResponseStatusCode[201],
        defaultResponseMessage?.CREATED,
        createData,
      ),
    );
};

exports.getAllBusiness = async (req, res) => {
  try {
    const {
      page = 1,
      search,
      disable,
      isBmAccessProvidedToAdminBm,
      type,
      staffId,
    } = req.query;

    const limit = 20;
    const skip = (page - 1) * limit;
    let query = {};

    if (search) query.businessName = new RegExp(search, "i");
    if (disable) query.disable = disable;
    if (type) query.type = type;
    if (isBmAccessProvidedToAdminBm)
      query.isBmAccessProvidedToAdminBm = isBmAccessProvidedToAdminBm;
      
    if (staffId) query.assignedStaff = staffId;

    const businesses = await businessService.getAllBusiness(query, skip, limit);
    const totalCount = await businessService.getBusinessCount(query);

    const pageCount = Math.ceil(totalCount / limit);

    return res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage.FETCHED,
          businesses,
          pageCount,
        ),
      );
  } catch (error) {
    console.error("getAllBusiness Error:", error);
    return res
      .status(statusCodes.INTERNAL_ERROR)
      .json(
        responseBuilder(
          apiResponseStatusCode[500],
          defaultResponseMessage.ERROR,
          error.message,
        ),
      );
  }
};

exports.updateBusiness = async (req, res) => {
  try {
    const business = req.bussiness;
    const businessImage = req.file
      ? req.file.location
      : business?.businessImage;

    if (req.file && business?.businessImage) {
      await deleteFileFromObjectStorage(business.businessImage);
    }

    const updateData = extractUpdateData(req.body, businessImage);

    // If pageId is provided, explicitly mark the business as Facebook page linked
    if (req.body.pageId) {
      updateData.isFacebookPageLinked = true;
      updateData.pageId = req.body.pageId;
      if (req.body.pageName) {
        updateData.pageName = req.body.pageName;
      }
    }

    // Handle Meta Access Token only when explicitly provided (don't wipe on name/contact edits)
    if (req.body.metaAccessToken) {
      const metaTokenResponse = await handleMetaAccessToken(
        req.body.metaAccessToken,
      );
      if (metaTokenResponse.error)
        return res.status(500).json(metaTokenResponse.error);
      updateData.metaAccessToken = metaTokenResponse.token;

      // Fetch long-lived Page Access Token (60 days/Never expiring) and Page Name
      if (req.body.pageId && metaTokenResponse.token) {
        try {
          const pageResponse = await axios.get(
            `https://graph.facebook.com/v21.0/${req.body.pageId}?fields=access_token,name&access_token=${metaTokenResponse.token}`,
          );
          if (pageResponse.data) {
            if (pageResponse.data.access_token) {
              updateData.pageAccessToken = pageResponse.data.access_token;
              req.body.pageAccessToken = pageResponse.data.access_token;
            }
            if (pageResponse.data.name && !updateData.pageName) {
              updateData.pageName = pageResponse.data.name;
            }
          }
        } catch (err) {
          console.warn(
            "Failed to fetch long-lived page access token",
            err.message,
          );
        }
      }
    }

    // Update Business
    let updatedBusiness = await businessService.updateBusiness(
      { _id: business._id },
      updateData,
    );

    // Handle Page Subscription and Business Manager
    if (req.body.pageId && req.body.pageAccessToken) {
      const pageSubscriptionResponse = await handlePageSubscription(
        updatedBusiness,
        req.body.pageId,
        req.body.pageAccessToken,
      );
      if (pageSubscriptionResponse.error) {
        console.warn("⚠️ Page subscription failed (non-blocking):", pageSubscriptionResponse.error.message);
      }

      const businessManagerResponse = await handleBusinessManagerAccess(
        updatedBusiness,
        req.body.pageId,
        req.body.pageAccessToken,
      );
      
      const clientUserName = await fetchClientUserName(req.body.pageAccessToken).catch(() => null);

      if (businessManagerResponse.error) {
        // BM assign fail (pending request / #200) — page tokens + leadgen phir bhi kaam karte hain.
        // App pe "Something went wrong" mat dikhao; linked mark karo, BM baad me repair ho sakta hai.
        console.warn("⚠️ BM access failed (non-blocking):", businessManagerResponse.error.message);
        updatedBusiness = await businessService.updateBusiness(
          { _id: updatedBusiness._id },
          {
            isFacebookPageLinked: true,
            isBmAccessProvidedToAdminBm: false,
            pageName: req.body.pageName || clientUserName || updatedBusiness.pageName,
          },
        );
        return res
          .status(statusCodes.OK)
          .json(
            responseBuilder(
              apiResponseStatusCode[200],
              defaultResponseMessage.UPDATED,
              updatedBusiness,
            ),
          );
      }

      updatedBusiness = await businessService.updateBusiness(
        { _id: businessManagerResponse.updatedBusiness._id },
        {
          isFacebookPageLinked: true,
          pageName: req.body.pageName || clientUserName || businessManagerResponse.updatedBusiness.pageName,
        }
      );
    } else if (req.body.pageId) {
      // Ensure pageId and isFacebookPageLinked are persisted even if pageAccessToken wasn't resolved
      updatedBusiness = await businessService.updateBusiness(
        { _id: business._id },
        {
          isFacebookPageLinked: true,
          pageId: req.body.pageId,
          pageName: req.body.pageName || updatedBusiness.pageName,
        }
      );
    }

    return res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage.UPDATED,
          updatedBusiness,
        ),
      );
  } catch (error) {
    console.error("Error updating business:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update business",
      error: error.message,
    });
  }
};

function extractUpdateData(body, businessImage) {
  return {
    businessName: body.businessName,
    userId: body.userId,
    businessCategoryId: body.businessCategoryId,
    servicesId: body.servicesId,
    businessContact: body.businessContact,
    whatsappNumber: body.whatsappNumber,
    stateId: body.stateId,
    cityId: body.cityId,
    websiteLink: body.websiteLink,
    instagramLink: body.instagramLink,
    countryId: body.countryId,
    twitterLink: body.twitterLink,
    youtubeLink: body.youtubeLink,
    facebookLink: body.facebookLink,
    address: body.address,
    tagline: body.tagline,
    businessImage,
    businessEmail: body.businessEmail,
    metaAccessToken: body.metaAccessToken,
    pageId: body.pageId,
    pageName: body.pageName,
    isFacebookPageLinked: body.isFacebookPageLinked,
    pageAccessToken: body.pageAccessToken,
    metaAdAccountId: body.metaAdAccountId,
  };
}

async function handleMetaAccessToken(metaAccessToken) {
  if (!metaAccessToken) return { token: null };
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v21.0/oauth/access_token`,
      {
        params: {
          client_id: process.env.clientId,
          client_secret: process.env.clientSecret,
          grant_type: "fb_exchange_token",
          fb_exchange_token: metaAccessToken,
        },
      },
    );
    return { token: data.access_token };
  } catch (error) {
    console.error("Error updating Meta Access Token:", error);
    return {
      error: {
        success: false,
        message: "Failed to update Meta Access Token",
        error: error.response?.data || error.message,
      },
    };
  }
}

async function handlePageSubscription(business, pageId, pageAccessToken) {
  if (business.isPageSubscribe) return {};
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`,
      null,
      {
        params: {
          subscribed_fields: "leadgen",
          access_token: pageAccessToken,
        },
      },
    );
    await businessService.updateBusiness(
      { _id: business._id },
      { isPageSubscribe: true },
    );
    return {};
  } catch (error) {
    console.error("Error subscribing page for leadgen:", error);
    return {
      error: {
        success: false,
        message: "Failed to subscribe page for leadgen",
        error: error.response?.data || error.message,
      },
    };
  }
}

async function handleBusinessManagerAccess(business, pageId, pageAccessToken) {
  if (business.isBmAccessProvidedToAdminBm)
    return { updatedBusiness: business };

  let isCoreLinked = false;
  let isSystemUserAssigned = false;
  let metaManagerId = business.metaManagerId;

  try {
    const clientUserId = await fetchClientUserId(business.metaAccessToken);
    console.log("Client User ID:", clientUserId);
    const clientUserName = await fetchClientUserName(pageAccessToken);
    console.log("Client User Name:", clientUserName);
    const clientEmail = (await fetchClientEmail(business.metaAccessToken)) || business.businessEmail || "noemail@leadkart.in";
    console.log("Client Email:", clientEmail);

    metaManagerId = await ensureBusinessManagerExists(
      clientUserId,
      business.metaAccessToken,
      clientEmail
    );
    console.log("Meta Business Manager ID:", metaManagerId);

    // Step 1: Assign Page to Business Manager (Core requirement for Agency)
    try {
      await assignPageToBusinessManager(metaManagerId, pageId, pageAccessToken);
      console.log("✅ Page assigned to Business Manager.");
      isCoreLinked = true;
    } catch (coreError) {
      console.error("❌ Core Link Error:", coreError.message);
      throw coreError; // Core step failed
    }

    // Step 2: Provide Access to App Owner Business Manager (Optional but helpful)
    try {
      await provideAccessToAppOwnerBusinessManager(
        metaManagerId,
        business.metaAccessToken,
        pageId
      );
      console.log("✅ Access provided to app owner's Business Manager.");
    } catch (optionalError) {
      console.warn("⚠️ BM access link warning (non-blocking):", optionalError.message);
    }

    // Step 3: Assign User to Page (needed for full BM / ads ops)
    try {
      await assignUserToPage(pageId, pageAccessToken);
      console.log("✅ User assigned to page.");
      isSystemUserAssigned = true;
    } catch (userError) {
      console.error("❌ User Assignment Error:", userError.message);
    }

    if (isCoreLinked && isSystemUserAssigned) {
      const updatedBusiness = await businessService.updateBusiness(
        { _id: business._id },
        {
          isBmAccessProvidedToAdminBm: true,
          metaMangerId: metaManagerId,
          isFacebookPageLinked: true,
          pageName: clientUserName,
        }
      );
      return { updatedBusiness };
    }

    // Core agency step ok (ya pending) lekin system-user assign nahi hua —
    // app ke liye page linked mark karo; BM flag false rahega for later repair.
    if (isCoreLinked) {
      const updatedBusiness = await businessService.updateBusiness(
        { _id: business._id },
        {
          isBmAccessProvidedToAdminBm: false,
          metaMangerId: metaManagerId,
          isFacebookPageLinked: true,
          pageName: clientUserName,
        }
      );
      return { updatedBusiness };
    }

    throw new Error(`Integration partially failed: CoreLinked=${isCoreLinked}, SystemUserAssigned=${isSystemUserAssigned}`);
  } catch (error) {
    console.error("❌ Meta Integration Final Error:", JSON.stringify(error.response?.data || error.message, null, 2));
    return {
      error: {
        success: false,
        message: error.response?.data?.error?.message || "Failed to manage Business Manager access",
        error: error.response?.data || error.message,
      },
    };
  }
}

async function fetchClientUserId(accessToken) {
  const { data } = await axios.get(
    `https://graph.facebook.com/v21.0/me?access_token=${accessToken}`,
  );
  return data.id;
}

async function fetchClientUserName(accessToken) {
  const { data } = await axios.get(
    `https://graph.facebook.com/v21.0/me?access_token=${accessToken}`,
  );
  return data.name;
}

async function fetchClientEmail(accessToken) {
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v21.0/me?fields=email&access_token=${accessToken}`,
    );
    return data.email || null;
  } catch (error) {
    console.warn("Could not fetch email from Graph API:", error.message);
    return null;
  }
}

async function ensureBusinessManagerExists(clientUserId, accessToken, email) {
  const { data } = await axios.get(
    `https://graph.facebook.com/v21.0/${clientUserId}/businesses?access_token=${accessToken}`,
  );
  if (data.data.length > 0) return data.data[0].id;
  const createPayload = {
    name: "Leadkart Partnered BM",
    vertical: "ADVERTISING",
    timezone_id: 1,
    access_token: accessToken,
  };
  if (email) {
    createPayload.email = email;
  }
  const { data: createResponse } = await axios.post(
    `https://graph.facebook.com/v21.0/${clientUserId}/businesses`,
    createPayload,
  );
  return createResponse.id;
}

// Check karta hai ki page LeadKart ke apne BM (process.env.businessId) me
// as a client page assigned hai ya nahi. Yahi wo list hai jo "Meta pe show"
// hone ka asli source of truth hai. Handles pagination.
async function isPageInLeadKartBM(pageId) {
  const leadKartBmId = process.env.businessId;
  let url = `https://graph.facebook.com/v21.0/${leadKartBmId}/client_pages`;
  let params = { access_token: process.env.systemUserAccessToken, limit: 200 };
  // 3 page tak paginate karo (600 pages) — safety cap
  for (let i = 0; i < 3; i++) {
    const { data } = await axios.get(url, { params });
    if ((data.data || []).some((item) => String(item.id) === String(pageId))) {
      return true;
    }
    const next = data.paging?.next;
    if (!next) break;
    url = next; // next already includes access_token + cursor
    params = undefined;
  }
  return false;
}

async function assignPageToBusinessManager(
  metaManagerId,
  pageId,
  pageAccessToken
) {
  try {
    // Idempotency: LeadKart ke BM me pehle se hai to skip karo (correct BM check).
    if (await isPageInLeadKartBM(pageId)) {
      console.log("✅ Page already in LeadKart Business Manager.");
      return;
    }

    console.log("Assigning page to LeadKart Business Manager agency...", { pageId, metaManagerId });
    await axios.post(`https://graph.facebook.com/v21.0/${pageId}/agencies`, {
      business: process.env.businessId,
      permitted_tasks: ["MANAGE", "ADVERTISE", "ANALYZE"],
      access_token: pageAccessToken,
    });
    console.log("✅ Page /agencies request sent to LeadKart BM.");
  } catch (error) {
    const errorData = error.response?.data?.error;
    // "Partner Already Has Access" (code 3989 / subcode 1690131) = effectively success
    if (errorData && (errorData.code === 3989 || errorData.error_subcode === 1690131)) {
      console.log("✅ Page already assigned (Meta 3989). Treating as success.");
      return;
    }
    // Duplicate / already-pending request — LeadKart BM me pehle se pending hai
    if (errorData && (errorData.error_subcode === 1752041 || errorData.code === 200)) {
      try {
        const leadKartBmId = process.env.businessId;
        const { data: pending } = await axios.get(
          `https://graph.facebook.com/v21.0/${leadKartBmId}/pending_client_pages`,
          {
            params: {
              access_token: process.env.systemUserAccessToken,
              limit: 100,
            },
          },
        );
        if ((pending.data || []).some((p) => String(p.id) === String(pageId))) {
          console.log("✅ Page already in LeadKart pending_client_pages — treating agency step as done.");
          return;
        }
      } catch (pendingErr) {
        console.warn("pending_client_pages check failed:", pendingErr.message);
      }
    }
    console.error("Error in assignPageToBusinessManager:", JSON.stringify(error.response?.data || error.message));
    throw error;
  }

  // VERIFY: assignment ke baad confirm karo ki page sach me LeadKart BM me aaya.
  // Meta thoda async hota hai — chhota retry loop.
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await isPageInLeadKartBM(pageId)) {
      console.log(`✅ Verified: page LeadKart BM me show ho raha hai (attempt ${attempt}).`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    "Page /agencies me bheja gaya lekin LeadKart Business Manager ki client_pages me abhi tak show nahi ho raha (verification fail). Page owner ne request accept nahi ki ya permission missing hai."
  );
}

async function provideAccessToAppOwnerBusinessManager(
  metaManagerId,
  accessToken,
  pageId,
) {
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v21.0/${process.env.businessId}/client_pages`,
      {
        params: { access_token: accessToken },
      },
    );
    if (data.data.some((item) => item.id === pageId)) return;
    await axios.post(
      `https://graph.facebook.com/v21.0/${process.env.businessId}/managed_businesses`,
      {
        existing_client_business_id: metaManagerId,
        access_token: accessToken,
      },
    );
  } catch (error) {
    console.error("Error providing access to Business Manager:", error);
    throw error;
  }
}

async function assignUserToPage(pageId, pageAccessToken) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${pageId}/assigned_users`,
      {
        user: process.env.assignUserId,
        tasks: ["MANAGE", "CREATE_CONTENT", "MODERATE", "ADVERTISE", "ANALYZE"],
        business: process.env.businessId,
        access_token: process.env.systemUserAccessToken,
      },
    );
    console.log("✅ User assigned to page.");
  } catch (error) {
    console.error("Error assigning user to page:", error);
    throw error;
  }
}

exports.getByIdBusiness = async (req, res) => {
  // const url = `https://graph.facebook.com/oauth/access_token_info?access_token=${req.bussiness?.metaAccessToken}`;

  // const response = await new Promise((resolve, reject) => {
  //   https
  //     .get(url, (resHttp) => {
  //       let data = "";
  //       resHttp.on("data", (chunk) => (data += chunk));
  //       resHttp.on("end", () => {
  //         try {
  //           const parsedData = JSON.parse(data);
  //           resolve(parsedData);
  //         } catch (error) {
  //           reject(error);
  //         }
  //       });
  //     })
  //     .on("error", (error) => reject(error));
  // });

  // if (req.bussiness.metaAccessToken) {
  //   console.log(req.bussiness.metaAccessToken);
  //   const response = await axios.post(
  //     `https://graph.facebook.com/v21.0/299039119952016/instagram_accounts?access_token=EAAOmDJUkZC6ABO9bLwbXWWi0pjdkfo04GzfmqrNtB9ibp7SQBZAtBcgW1A1ofpJevMGPOJKVGIoHC6bWUWpAIt3v6gR69CXBCmXA4cEZAtHbpb9OXNjbDxkSZCeYVjyHLZAsFKT3ake4jUh1eEwqpKrxsSNGlOrJN4Kh0Dq2dSLkI0pYucxo7vx4TXC9LsiZAJZBYZBUW6RlRZBqVezLL&fields=id,username,profile_pic`
  //   );
  //   console.log("Response Data:", response.data);
  // }

  // req.bussiness._doc.isPageAccessTokenActive = true;
  // req.bussiness._doc.isMetaAccessTokenActive = true;
  // if (response?.error) {
  //   req.bussiness._doc.isMetaAccessTokenActive = false;
  // }
  req.bussiness._doc.is_instagram_account_associates = null;
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        req.bussiness,
      ),
    );
};

exports.disableBusiness = async (req, res) => {
  const getBusinessById = req.bussiness;
  const updateDisable = await businessService.disableBusiness(getBusinessById);
  let message = updateDisable.disable
    ? defaultResponseMessage?.DISABLED
    : defaultResponseMessage?.ENABLED;

  return res
    .status(statusCodes.OK)
    .json(responseBuilder(apiResponseStatusCode[200], message));
};

exports.getAllBusinessByUserId = async (req, res) => {
  const getAll = await businessService.getAllBusinessByUserId(req.user);

  // Auto-backfill pageName for any linked business that is missing it
  for (const b of getAll) {
    if (b.pageId && !b.pageName) {
      const token = b.pageAccessToken || b.metaAccessToken;
      if (token) {
        try {
          const { data } = await axios.get(
            `https://graph.facebook.com/v21.0/${b.pageId}?fields=name&access_token=${token}`,
            { timeout: 3000 }
          );
          if (data && data.name) {
            b.pageName = data.name;
            await businessModel.findByIdAndUpdate(b._id, { pageName: data.name });
          }
        } catch (_) {}
      }
    }
  }

  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        getAll,
      ),
    );
};

exports.getBusinessListForAdmin = async (req, res) => {
  const {
    page = 1,
    businessName,
    sort,
    disable,
    businessCategoryId,
    cityId,
    staffId,
    startDate,
    endDate,
    status
  } = req.query;
  const limit = 20;
  const skip = (page - 1) * limit;
  let query = {};

  if (businessName) {
    query.businessName = new RegExp(businessName, "i");
  }
  if (disable !== undefined) {
    query.disable = disable;
  }
  if (businessCategoryId) {
    query.businessCategoryId = businessCategoryId;
  }
  if (cityId) {
    query.cityId = cityId;
  }
  if (staffId) {
    query.assignedStaff = staffId;
  }
  if (status) {
    query.status = status;
  }
  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const getAll = await businessModel
    .find(query)
    .populate("userId")
    .populate({ path: "assignedStaff", populate: { path: "userId", select: "name email mobile" } })
    .populate("statusUpdatedBy", "name image mobile")
    .sort({ createdAt: parseInt(sort) || -1 })
    .skip(skip)
    .limit(limit);

  const totalCount = await businessModel.countDocuments(query);
  const pageCount = Math.ceil(totalCount / limit);

  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        getAll,
        pageCount,
      ),
    );
};

exports.getBusinessIdForAdmin = async (req, res) => {
  const { businessId } = req.query;
  let data = await businessService.getBusinessByIdForAdmin(businessId);
  return res
    .status(statusCodes.OK)
    .json(
      responseBuilder(
        apiResponseStatusCode[200],
        defaultResponseMessage?.FETCHED,
        data,
      ),
    );
};

exports.getUsersAllBusinessList = async (req, res) => {
  try {
    // const {page} = req.query
    // const skip = page?(page-1)*20:0
    console.log(req.user._id);
    const businessList = await permissionModel.aggregate([
      {
        $match: { userId: req.user._id },
      },
      {
        $lookup: {
          from: "businesses", // Replace 'businesses' with your actual business model collection name
          localField: "businessId",
          foreignField: "_id",
          as: "businessData",
        },
      },
      {
        $unwind: "$businessData",
      },
      {
        $addFields: {
          "businessData.roleName": "$roleName",
          "businessData.permissions": "$permissions",
        },
      },
      {
        $replaceRoot: { newRoot: "$businessData" },
      },
    ]);

    return res
      .status(statusCodes.OK)
      .json(
        responseBuilder(
          apiResponseStatusCode[200],
          defaultResponseMessage?.FETCHED,
          businessList,
        ),
      );
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.unLinkPage = async (req, res) => {
  try {
    const { businessId } = req.body;
    await businessModel.findByIdAndUpdate(
      {
        _id: businessId,
      },
      {
        pageId: "",
        pageAccessToken: "",
        pageName: "",
        metaAccessToken: "",
        isPageSubscribe: false,
        isBmAccessProvidedToAdminBm: false,
        isFacebookPageLinked: false,
      },
      { new: true },
    );
    return res.status(200).json({
      success: true,
      message: "unlink Page Successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateBusinessStatus = async (req, res) => {
  const { businessId } = req.query;
  const { status } = req.body;
  try {
    const updatedBusiness = await businessModel.findByIdAndUpdate(
      businessId,
      { 
        status: status,
        ...(status && {
          statusUpdatedAt: new Date(),
          statusUpdatedBy: req.user?._id || req.body?.userId // fallback if user not in req
        })
      },
      { new: true },
    );
    if (!updatedBusiness) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Status updated successfully",
      data: updatedBusiness,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.addBusinessFollowUp = async (req, res) => {
  const { id } = req.query;
  const { scheduledTime, notes } = req.body;

  try {
    const updatedBusiness = await businessModel.findByIdAndUpdate(
      id,
      {
        $push: {
          followUps: {
            scheduledTime,
            notes,
          },
        },
      },
      { new: true },
    );

    if (!updatedBusiness) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Note added successfully",
      data: updatedBusiness,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteBusinessFollowUp = async (req, res) => {
  const { businessId, noteId } = req.query;

  try {
    const updatedBusiness = await businessModel.findByIdAndUpdate(
      businessId,
      {
        $pull: {
          followUps: { _id: noteId },
        },
      },
      { new: true },
    );

    if (!updatedBusiness) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Note deleted successfully",
      data: updatedBusiness,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteBusiness = async (req, res) => {
  const { businessId } = req.query;

  try {
    const data = await businessModel.findByIdAndDelete(businessId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Business deleted successfully",
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.assignBusiness = async (req, res) => {
  const { businessId, staffId } = req.query;
  try {
    const updatedBusiness = await businessModel.findByIdAndUpdate(
      businessId,
      { assignedStaff: staffId || null },
      { new: true },
    ).populate('assignedStaff');

    if (!updatedBusiness) {
      return res.status(404).json({
        success: false,
        message: "Business not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Staff assigned successfully",
      data: updatedBusiness,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.linkMetaAd = async (req, res) => {
  try {
    let { metaId, businessIdentifier, pageName } = req.body;

    console.log("linkMetaAd Request received:", { metaId, businessIdentifier, pageName });

    // Trim whitespace if they are strings
    if (typeof metaId === 'string') metaId = metaId.trim();
    if (typeof businessIdentifier === 'string') businessIdentifier = businessIdentifier.trim();
    if (typeof pageName === 'string') pageName = pageName.trim();

    if (!metaId || !businessIdentifier) {
      return res.status(statusCodes["Bad Request"]).json({
        success: false,
        message: `Missing required fields: ${!metaId ? 'metaId ' : ''}${!businessIdentifier ? 'businessIdentifier' : ''}`.trim(),
      });
    }

    const accessToken = process.env.systemUserAccessToken;
    if (!accessToken) {
      return res.status(500).json({
        success: false,
        message: "systemUserAccessToken is not configured on the server",
      });
    }

    // 1. Find the Business by phone number or name
    let business;
    if (/^\d+$/.test(businessIdentifier)) {
      const phoneNum = parseInt(businessIdentifier);
      business = await businessModel
        .findOne({
          $or: [{ businessContact: phoneNum }, { whatsappNumber: phoneNum }],
        })
        .sort({ createdAt: -1 });
    } else {
      business = await businessModel
        .findOne({
          businessName: new RegExp(businessIdentifier, "i"),
        })
        .sort({ createdAt: -1 });
    }

    if (!business) {
      return res.status(404).json({
        success: false,
        message: `Business not found with phone or name matching "${businessIdentifier}"`,
      });
    }

    // 2. Fetch the Meta ID to auto-detect creatives
    let videoId = null;
    let thumbnailUrl = null;
    let fullImageUrl = null;
    let campaignName = "Manually Linked Campaign";
    let isVideo = false;

    let metaRes;
    let adCreativeId = null;

    try {

      // Try as Campaign/AdSet first
      try {
        metaRes = await axios.get(
          `https://graph.facebook.com/v22.0/${metaId}?access_token=${accessToken}&fields=name,status,campaign_id,adset_id,ads{id,name,campaign_id,adset_id,creative{id,effective_object_story_id,video_id,image_url,image_hash,thumbnail_url,object_story_spec}}`,
        );
      } catch (err) {
        console.log("linkMetaAd: Not a campaign/adset, trying as Ad ID...", err?.response?.data?.error?.message || err.message);
      }

      if (
        metaRes &&
        metaRes.data &&
        metaRes.data.ads &&
        metaRes.data.ads.data &&
        metaRes.data.ads.data.length > 0
      ) {
        campaignName = metaRes.data.name || campaignName;
        const ad = metaRes.data.ads.data[0];
        if (ad.creative) {
          videoId = ad.creative.video_id;
          adCreativeId = ad.creative.id;
          fullImageUrl = ad.creative.image_url;
          thumbnailUrl = ad.creative.thumbnail_url;
        }
      } else if (metaRes && metaRes.data && metaRes.data.name) {
        // It's a valid campaign/adset but has no ads yet
        campaignName = metaRes.data.name;
      } else {
        // Try fetching as Ad directly
        try {
          const adRes = await axios.get(
            `https://graph.facebook.com/v22.0/${metaId}?access_token=${accessToken}&fields=name,campaign_id,adset_id,creative{id,effective_object_story_id,video_id,image_url,image_hash,thumbnail_url,object_story_spec}`,
          );
          metaRes = adRes;
          campaignName = adRes.data.name || campaignName;
          if (adRes.data.creative) {
            videoId = adRes.data.creative.video_id;
            adCreativeId = adRes.data.creative.id;
            fullImageUrl = adRes.data.creative.image_url;
            thumbnailUrl = adRes.data.creative.thumbnail_url;
          }
        } catch (adErr) {
          console.log("linkMetaAd: Could not fetch as Ad either:", adErr?.response?.data?.error?.message || adErr.message);
        }
      }

      // If we have full image URL, use it; otherwise try to get full image from creative
      if (!fullImageUrl && adCreativeId) {
        try {
          const creativeRes = await axios.get(
            `https://graph.facebook.com/v22.0/${adCreativeId}?access_token=${accessToken}&fields=image_url,thumbnail_url,object_story_spec`,
          );
          fullImageUrl = creativeRes.data.image_url || creativeRes.data.thumbnail_url;

          // Try to extract image from object_story_spec
          if (!fullImageUrl && creativeRes.data.object_story_spec) {
            const spec = creativeRes.data.object_story_spec;
            if (spec.link_data && spec.link_data.picture) {
              fullImageUrl = spec.link_data.picture;
            }
          }
        } catch (creativeErr) {
          // Ignore creative fetch errors
        }
      }

      // Final fallback: use thumbnail_url if no full image found
      if (!fullImageUrl) {
        fullImageUrl = thumbnailUrl;
      }
    } catch (apiError) {
      console.error("linkMetaAd Meta API error:", apiError?.response?.data || apiError.message);
      // Don't block linking - continue without image
    }

      // Extract real Meta AD id (webhook matches mainAdId === ad_id)
      let resolvedAdId = null;
      let adsetId = null;
      if (metaRes?.data?.ads?.data?.[0]?.id) {
        resolvedAdId = metaRes.data.ads.data[0].id;
        adsetId =
          metaRes.data.ads.data[0].adset_id ||
          metaRes.data.id ||
          null;
        campaignName =
          metaRes.data.ads.data[0].name || metaRes.data.name || campaignName;
      } else if (metaRes?.data?.adset_id && metaRes?.data?.creative) {
        // metaId was already an Ad
        resolvedAdId = metaRes.data.id || metaId;
        adsetId = metaRes.data.adset_id;
      }

      // Extract adset_id if not yet resolved
      if (!adsetId) {
        if (metaRes?.data?.adset_id) {
          adsetId = metaRes.data.adset_id;
        } else if (metaRes?.data?.ads?.data?.[0]?.adset_id) {
          adsetId = metaRes.data.ads.data[0].adset_id;
        } else if (metaRes?.data?.id) {
          // If metaId was a campaign, query its adsets + first ad
          try {
            const adsetsRes = await axios.get(
              `https://graph.facebook.com/v22.0/${metaId}/adsets?access_token=${accessToken}&fields=id`,
            );
            if (adsetsRes.data?.data?.length > 0) {
              adsetId = adsetsRes.data.data[0].id;
            }
          } catch (e) {
            console.log("Could not fetch adsets from campaign");
          }
          if (!resolvedAdId) {
            try {
              const adsRes = await axios.get(
                `https://graph.facebook.com/v22.0/${metaId}/ads?access_token=${accessToken}&fields=id,name,adset_id&limit=1`,
              );
              if (adsRes.data?.data?.[0]?.id) {
                resolvedAdId = adsRes.data.data[0].id;
                adsetId = adsRes.data.data[0].adset_id || adsetId;
                campaignName = adsRes.data.data[0].name || campaignName;
              }
            } catch (e) {
              console.log("Could not fetch ads from campaign");
            }
          }
        }
      }

      // Direct ad fetch path may not have set resolvedAdId
      if (!resolvedAdId && metaRes?.data?.creative) {
        resolvedAdId = metaRes.data.id || metaId;
      }
      if (!resolvedAdId) {
        // Last resort: if admin pasted an ad id that was fetched in the Ad branch
        try {
          const adOnly = await axios.get(
            `https://graph.facebook.com/v22.0/${metaId}?access_token=${accessToken}&fields=id,name,adset_id,campaign_id`,
          );
          if (adOnly.data?.id && adOnly.data?.adset_id) {
            resolvedAdId = adOnly.data.id;
            adsetId = adOnly.data.adset_id || adsetId;
            campaignName = adOnly.data.name || campaignName;
          }
        } catch (_e) {
          /* ignore */
        }
      }

      if (!resolvedAdId) {
        return res.status(400).json({
          success: false,
          message:
            "Could not resolve a Meta Ad ID from the provided ID. Paste the Ad ID (not only campaign/ad set) so Form Leads can match.",
        });
      }
      
      if (!adsetId && metaRes?.data?.id) {
          adsetId = metaRes.data.id; // fallback
      }
      
      // Fetch budget and targeting if adsetId is found
      let fetchedBudget = 150;
      let targetingData = {};
      try {
        let budgetAdSetId = adsetId || metaId; // try metaId as fallback
        const adsetRes = await axios.get(
          `https://graph.facebook.com/v22.0/${budgetAdSetId}?access_token=${accessToken}&fields=daily_budget,lifetime_budget,targeting`,
        );
        if (adsetRes.data.daily_budget) {
          fetchedBudget = parseInt(adsetRes.data.daily_budget) / 100;
        } else if (adsetRes.data.lifetime_budget) {
          fetchedBudget = parseInt(adsetRes.data.lifetime_budget) / 100;
        }
        
        // Parse targeting
        if (adsetRes.data.targeting) {
             const targeting = adsetRes.data.targeting;
             if (targeting.geo_locations) targetingData.location = targeting.geo_locations;
             if (targeting.age_min) targetingData.ageRangeFrom = targeting.age_min;
             if (targeting.age_max) targetingData.ageRangeTo = targeting.age_max;
             if (targeting.genders) {
                 targetingData.audienceGender = targeting.genders.map(g => g === 1 ? "Male" : (g === 2 ? "Female" : g));
             }
             if (targeting.flexible_spec && targeting.flexible_spec.length > 0) {
                 let interests = [];
                 targeting.flexible_spec.forEach(spec => {
                     if (spec.interests) {
                         interests.push(...spec.interests.map(i => ({ name: i.name, id: i.id })));
                     }
                 });
                 targetingData.interest = interests;
             }
         }
      } catch (budgetErr) {
        // Not an adset or no permission, fallback to 150
        console.log("linkMetaAd: Could not fetch budget/targeting, defaulting to 150");
      }

    if (videoId) isVideo = true;

    const finalPageName = pageName || business.businessName;

    // Re-host Meta's temporary signed URL to permanent storage — Meta's own URL expires within hours
    if (fullImageUrl) {
      const hostedImageUrl = await uploadUrlToBucket(fullImageUrl, "LEADKART/IMAGE/META/");
      if (hostedImageUrl) fullImageUrl = hostedImageUrl;
    }

    // 3. Create/Update InternalCampaignModel Record — store real Meta AD id for webhooks
    const campaignData = {
      mainAdId: resolvedAdId,
      metaAdId: resolvedAdId,
      businessId: business._id,
      addTypeId: "676bd7b708acbc4f1ca6a8b6",
      title: campaignName,
      pageName: finalPageName,
      status: "ACTIVE",
      paymentStatus: "APPROVED",
      facebookAdSetId: adsetId,
      isFacebookAdEnabled: true,

      isInstaAdEnabled: true,
      thambnail: fullImageUrl || null,
      image: fullImageUrl ? [fullImageUrl] : [],
      startDate: new Date().toISOString(),
      dailyBudget: fetchedBudget,
      totalBudget: fetchedBudget,
      facebookBudget: fetchedBudget,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...targetingData
    };

    if (isVideo) {
      campaignData.videoId = videoId;
    }

    let existing = await internalCampaignModel.findOne({
      $or: [{ mainAdId: resolvedAdId }, { metaAdId: resolvedAdId }, { mainAdId: metaId }],
    });
    if (existing) {
      await internalCampaignModel.updateOne(
        { _id: existing._id },
        { $set: campaignData },
      );
    } else {
      existing = await internalCampaignModel.create(campaignData);
    }
    
    // Do NOT bulk-import all page Instant Form leads onto a newly linked ad.
    // That incorrectly attributes historical leadgen leads to WhatsApp/CTWA ads
    // and inflates mobile app lead counts with unrelated "fake" data.
    // Lead attribution should only come from webhooks / ad_id-matched sync.

    return res.status(200).json({
      success: true,
      message: `Ad linked successfully to "${business.businessName}" as "${finalPageName}"`,
      data: {
        businessName: business.businessName,
        businessId: business._id,
        metaId,
        campaignName,
        pageName: finalPageName,
        isVideo,
      },
    });
  } catch (error) {
    console.error("linkMetaAd Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to link Meta Ad",
      error: error.message,
    });
  }
};

/**
 * Retry BM assignment + leadgen webhook for an already-saved page.
 * Use when pageId/tokens exist but isBmAccessProvidedToAdminBm is false.
 * If tokens are expired, returns 401 with message to re-link from app.
 */
exports.repairFacebookPageLink = async (req, res) => {
  try {
    const { businessId } = req.body;
    if (!businessId) {
      return res.status(400).json({ success: false, message: "businessId required" });
    }

    const business = await businessModel.findById(businessId);
    if (!business) {
      return res.status(404).json({ success: false, message: "Business not found" });
    }
    if (!business.pageId || !business.pageAccessToken) {
      return res.status(400).json({
        success: false,
        message: "Page ID ya pageAccessToken missing — user ko app se dubara Connect Page karna hoga.",
      });
    }

    // Token alive?
    try {
      await axios.get(`https://graph.facebook.com/v21.0/me`, {
        params: { access_token: business.pageAccessToken },
      });
    } catch (tokenErr) {
      const msg = tokenErr.response?.data?.error?.message || tokenErr.message;
      return res.status(401).json({
        success: false,
        message: "Facebook token expire/invalid hai. User ko app me Unlink → Connect Page karna hoga.",
        error: msg,
      });
    }

    // Re-run subscription (reset flag so it retries)
    await businessService.updateBusiness({ _id: business._id }, { isPageSubscribe: false });
    const subResult = await handlePageSubscription(business, business.pageId, business.pageAccessToken);
    if (subResult.error) {
      console.warn("repair: page subscription warning:", subResult.error.message);
    }

    // Re-run BM assignment
    await businessService.updateBusiness(
      { _id: business._id },
      { isBmAccessProvidedToAdminBm: false },
    );
    const bmResult = await handleBusinessManagerAccess(
      business,
      business.pageId,
      business.pageAccessToken,
    );

    if (bmResult.error) {
      await businessService.updateBusiness(
        { _id: business._id },
        { isFacebookPageLinked: false, isBmAccessProvidedToAdminBm: false },
      );
      return res.status(422).json({
        success: false,
        message: "BM assignment dubara fail hua",
        error: bmResult.error.message,
      });
    }

    const pageName = await fetchClientUserName(business.pageAccessToken).catch(() => business.pageName);
    const updated = await businessService.updateBusiness(
      { _id: business._id },
      { isFacebookPageLinked: true, pageName: pageName || business.pageName },
    );

    return res.status(200).json({
      success: true,
      message: "Facebook page link repair successful — Meta BM me assign ho gaya.",
      data: updated,
    });
  } catch (error) {
    console.error("repairFacebookPageLink Error:", error);
    return res.status(500).json({
      success: false,
      message: "Repair failed",
      error: error.message,
    });
  }
};

exports.forceLinkFacebookPage = async (req, res) => {
  try {
    const { businessIdentifier, pageName, pageId, metaAccessToken } = req.body;

    if (!businessIdentifier || !pageName) {
      return res.status(400).json({
        success: false,
        message: "businessIdentifier (phone/name) and pageName are required",
      });
    }

    // 1. Find the Business
    let business;
    if (/^\d+$/.test(businessIdentifier)) {
      const phoneNum = parseInt(businessIdentifier);
      business = await businessModel
        .findOne({
          $or: [{ businessContact: phoneNum }, { whatsappNumber: phoneNum }],
        })
        .sort({ createdAt: -1 });
    } else {
      business = await businessModel
        .findOne({
          businessName: new RegExp(businessIdentifier.trim(), "i"),
        })
        .sort({ createdAt: -1 });
    }

    if (!business) {
      return res.status(404).json({
        success: false,
        message: `Business not found matching "${businessIdentifier}"`,
      });
    }

    // 2. Force Link
    const updateData = {
      isFacebookPageLinked: true,
      pageName: pageName,
      pageId: pageId || business.pageId,
      isPageSubscribe: true,
    };

    if (metaAccessToken) {
      updateData.metaAccessToken = metaAccessToken;
    }

    await businessModel.updateOne({ _id: business._id }, { $set: updateData });

    return res.status(200).json({
      success: true,
      message: `Facebook Page "${pageName}" successfully forced-linked to "${business.businessName}"`,
      data: {
        businessId: business._id,
        businessName: business.businessName,
        pageName,
        pageId: updateData.pageId,
      },
    });
  } catch (error) {
    console.error("forceLinkFacebookPage Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to force link Facebook page",
      error: error.message,
    });
  }
};

