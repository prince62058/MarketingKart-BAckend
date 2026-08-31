const {
  statusCodes,
  defaultResponseMessage,
  apiResponseStatusCode,
} = require("../Message/defaultMessage");
const adsDetailsService = require("../services/adsDetailsService");
const responseBuilder = require("../utils/responseBuilder");
const axios = require("axios");
const internalCampaignModel = require("../models/internalCampiagnModel");
const advertisementModel = require("../models/advertisementModel");
const ExternalCampaignsModel = require("../models/ExternalCampaignsModel");
const planModel = require("../models/planModel");
const userModel = require("../models/userModel");
const commpanyModel = require("../models/commpanyModelV2");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const businessModel = require("../models/businessModel");
const leadModel = require("../models/leadModel");
const leadFormModel = require("../models/leadFormsModel");
const addDetailsModel = require("../models/adsDetailModel");
const logger = require("../utils/logger");
const AdErrorLog = require("../models/AdErrorLog");
const internalCampaignServices = require("../services/internalCampiagnService");
const { generateInvoice } = require("./invoiceController");
const mongoose = require("mongoose");
const { createTransaction } = require("./transtionController");
const Transaction = require("../models/transtionModel");
const { DEFAULT_FEES } = require("../startup/seedCompanySettings");
const Notification = require("../models/notificationModel");
const OpenAI = require("openai");
const { uploadUrlToBucket } = require("../utils/bucketHelper");
const { sendAdStatusNotification, sendLeadNotification } = require("../helpers/appNotificationHelper");
const {
  AD_KIND,
  kindFromAdvertisementType,
  metaOutcomeFromAdvertisementType,
} = require("../helpers/adTypeHelper");
const {
  syncCampaignStatuses,
  applyStatusToDocs,
} = require("../helpers/metaStatusHelper");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key",
});

/** Leadkart advertisement type ObjectIds */
// Ad behaviour is keyed off advertisementModel.advertisementType (a schema
// enum, stable across databases) via helpers/adTypeHelper. It used to be keyed
// off hardcoded _ids, which stopped matching the moment the ad types were
// re-seeded — see that helper for what broke.

const normalizeWhatsAppPhone = (raw) => {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
};

/** Prefer Meta's user-facing message over axios's generic "status code 400". */
const formatMetaAxiosError = (error) => {
  const meta = error?.response?.data?.error;
  if (meta) {
    return (
      meta.error_user_msg ||
      meta.error_user_title ||
      meta.message ||
      error.message ||
      "Meta API error"
    );
  }
  return error?.message || "Meta API error";
};

/** Build Click-to-WhatsApp CTA link from a normalized phone (digits with country code). */
const buildWhatsAppCtaLink = (rawPhone) => {
  const phone = normalizeWhatsAppPhone(rawPhone);
  if (!phone) return "https://api.whatsapp.com/send";
  return `https://api.whatsapp.com/send?phone=${phone}`;
};

/**
 * Map LeadKart advertisementType / ad-type id → Meta campaign objective.
 * DB stores LEADS / WHATSAPP_MESSAGES; Meta needs OUTCOME_* values.
 */
const mapAdvertisementTypeToMetaOutcome = (advertisementType) => {
  const resolved = metaOutcomeFromAdvertisementType(advertisementType);
  if (resolved) return resolved;

  const map = {
    LEADS: "OUTCOME_LEADS",
    WHATSAPP_MESSAGES: "OUTCOME_ENGAGEMENT",
    WEBSITE_VISITORS: "OUTCOME_TRAFFIC",
    APP_INSTALLS: "APP_INSTALLS",
    POST_ENGAGEMENT: "OUTCOME_ENGAGEMENT",
    PAGE_LIKES: "OUTCOME_ENGAGEMENT",
    VIDEO_VIEWS: "OUTCOME_AWARENESS",
    CALLS: "OUTCOME_TRAFFIC",
    EVENT_RESPONSES: "OUTCOME_ENGAGEMENT",
    OFFER_CLAIMS: "OUTCOME_SALES",
    PRODUCT_CATALOG_SALES: "OUTCOME_SALES",
    STORE_VISITS: "OUTCOME_TRAFFIC",
  };
  return map[advertisementType] || advertisementType;
};

/** Parse "HH:MM" / "H:MM" / number → minutes from midnight. */
const timeToMinutes = (value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1440, Math.round(value)));
  }
  const str = String(value).trim();
  if (/^\d+$/.test(str)) {
    return Math.max(0, Math.min(1440, parseInt(str, 10)));
  }
  const match = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/**
 * App sends days as [1..7] (Mon=1 … Sun=7). Meta adset_schedule uses 0=Sun … 6=Sat.
 * Also accepts already-Meta 0..6.
 */
const normalizeMetaScheduleDays = (days) => {
  let parsed = days;
  if (typeof days === "string") {
    try {
      parsed = JSON.parse(days.replace(/\\/g, ""));
    } catch (_e) {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const mapped = parsed
    // Number(null) is 0, which would silently add Sunday to the schedule.
    .filter((d) => d !== null && d !== undefined && d !== "")
    .map((d) => Number(d))
    .filter((n) => Number.isFinite(n))
    .map((n) => {
      if (n >= 0 && n <= 6) return n;
      if (n === 7) return 0; // Sun in 1–7 week
      if (n >= 1 && n <= 6) return n; // Mon–Sat align with Meta
      return null;
    })
    .filter((n) => n !== null);

  return [...new Set(mapped)];
};

/**
 * Build Meta `adset_schedule` or null (omit = all-day delivery).
 * Replaces invalid legacy `day_parting` + "HH:MM" strings.
 */
const buildMetaAdSetSchedule = (days, dayStartTime, dayEndTime) => {
  const metaDays = normalizeMetaScheduleDays(days);
  if (!metaDays.length) return null;

  let startMinute = timeToMinutes(dayStartTime);
  let endMinute = timeToMinutes(dayEndTime);

  // Default full day when times missing/invalid
  if (startMinute == null) startMinute = 0;
  if (endMinute == null) endMinute = 1440;

  // Meta requires end > start within the same day window
  if (endMinute <= startMinute) {
    startMinute = 0;
    endMinute = 1440;
  }

  return [
    {
      days: metaDays,
      start_minute: startMinute,
      end_minute: endMinute,
    },
  ];
};

/**
 * What a customer is charged for `adSpend` rupees of Meta budget.
 *
 * All-inclusive, and the exact mirror of the app's calculateFromTotal: the
 * platform fee and GST are charged on the ad spend, and the gateway fee on top
 * of all three. Two things this must never do again — read a fee as
 * `undefined / 100` (NaN, which failed the ad's DEBIT cast and killed the ad
 * before Meta was called), or leave GST out (which made a wallet-funded ad
 * cheaper than the identical ad bought through Razorpay).
 */
const computeAdChargeBreakdown = (adSpend, company) => {
  const pct = (value, fallback) => {
    const n = Number(value);
    return (Number.isFinite(n) ? n : fallback) / 100;
  };
  const base = Number(adSpend) || 0;
  const platformCharge = base * pct(company?.serviceFee, DEFAULT_FEES.serviceFee);
  const gstCharge = base * pct(company?.gstFee, DEFAULT_FEES.gstFee);
  const gatewayCharge =
    (base + platformCharge + gstCharge) *
    pct(company?.paymentGetWayFee, DEFAULT_FEES.paymentGetWayFee);

  return {
    adSpend: base,
    platformCharge,
    gstCharge,
    gatewayCharge,
    total: Math.ceil(base + platformCharge + gstCharge + gatewayCharge),
  };
};

const getMetaAccessToken = () =>
  process.env.systemUserAccessToken || process.env.admin_access_token;

/**
 * Resolve Meta optimization / destination / promoted_object for Lead Form + WhatsApp.
 */
const resolveMetaAdSetConfig = ({
  adKind,
  pageId,
  leadFormId,
  mobileNumber,
  optimization_goal,
  billing_event,
  application_id,
  destinationUrl,
}) => {
  if (adKind === AD_KIND.LEAD_FORM) {
    return {
      optimization_goal: "LEAD_GENERATION",
      billing_event: "IMPRESSIONS",
      destination_type: "ON_AD",
      promoted_object: {
        page_id: pageId,
        ...(leadFormId ? { lead_gen_form_id: String(leadFormId) } : {}),
      },
    };
  }
  if (adKind === AD_KIND.WHATSAPP) {
    const phone = normalizeWhatsAppPhone(mobileNumber);
    return {
      optimization_goal: "CONVERSATIONS",
      billing_event: "IMPRESSIONS",
      destination_type: "WHATSAPP",
      promoted_object: {
        page_id: pageId,
        ...(phone ? { whatsapp_phone_number: phone } : {}),
      },
    };
  }
  if (application_id) {
    return {
      optimization_goal: optimization_goal || "APP_INSTALLS",
      billing_event: billing_event || "IMPRESSIONS",
      destination_type: null,
      promoted_object: {
        application_id,
        object_store_url: destinationUrl,
      },
    };
  }
  return {
    optimization_goal: optimization_goal || "REACH",
    billing_event: billing_event || "IMPRESSIONS",
    destination_type: null,
    promoted_object: null,
  };
};

const setMetaObjectStatus = async (objectId, status) => {
  if (!objectId || !status) return { ok: false, skipped: true };
  const token = getMetaAccessToken();
  if (!token) return { ok: false, error: "Missing Meta access token" };
  try {
    await axios.post(`https://graph.facebook.com/v22.0/${objectId}`, {
      status,
      access_token: token,
    });
    return { ok: true };
  } catch (error) {
    console.error(
      `setMetaObjectStatus failed for ${objectId}:`,
      error.response?.data || error.message,
    );
    return {
      ok: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
};

/**
 * Resolve Meta delivery IDs when admin linked a campaign/adset id,
 * or when facebookAdSetId was never persisted after create.
 * Returns { adId, adsetId, campaignId } (any may be null).
 */
const resolveMetaDeliveryIds = async (seedId) => {
  const token = getMetaAccessToken();
  if (!seedId || !token) return { adId: null, adsetId: null, campaignId: null };

  const get = async (path, fields) => {
    const { data } = await axios.get(`https://graph.facebook.com/v22.0/${path}`, {
      params: { access_token: token, fields, limit: 5 },
      timeout: 15000,
    });
    return data;
  };

  let adId = null;
  let adsetId = null;
  let campaignId = null;

  // 1) Prefer: seed is already an Ad
  try {
    const ad = await get(seedId, "id,name,adset_id,campaign_id");
    if (ad?.adset_id) {
      return {
        adId: ad.id || seedId,
        adsetId: ad.adset_id,
        campaignId: ad.campaign_id || null,
      };
    }
  } catch (_e) {
    /* not an ad / rate limit / field missing */
  }

  // 2) Seed is an Ad Set — take first child ad
  try {
    const adset = await get(seedId, "id,name,campaign_id,ads.limit(1){id,name,adset_id}");
    if (adset?.campaign_id || adset?.ads?.data?.length) {
      const child = adset.ads?.data?.[0];
      return {
        adId: child?.id || null,
        adsetId: adset.id || seedId,
        campaignId: adset.campaign_id || null,
      };
    }
  } catch (_e) {
    /* not an adset */
  }

  // 3) Seed is a Campaign — first adset + first ad (via edges)
  try {
    const adsEdge = await get(`${seedId}/ads`, "id,name,adset_id,campaign_id");
    const firstAd = adsEdge?.data?.[0];
    if (firstAd?.id) {
      adId = firstAd.id;
      adsetId = firstAd.adset_id || null;
      campaignId = firstAd.campaign_id || seedId;
    }
  } catch (_e) {
    /* ignore */
  }
  if (!adsetId) {
    try {
      const adsetsEdge = await get(`${seedId}/adsets`, "id,name");
      adsetId = adsetsEdge?.data?.[0]?.id || null;
      if (adsetId) campaignId = campaignId || seedId;
    } catch (_e) {
      /* ignore */
    }
  }
  if (!adId && adsetId) {
    try {
      const adsUnder = await get(`${adsetId}/ads`, "id,name,adset_id");
      adId = adsUnder?.data?.[0]?.id || null;
    } catch (_e) {
      /* ignore */
    }
  }

  return { adId, adsetId, campaignId: campaignId || (adsetId || adId ? seedId : null) };
};

const ensurePublicMediaUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let normalized = rawUrl.trim();
  if (!normalized) return null;

  if (!/^https?:\/\//i.test(normalized)) {
    if (normalized.startsWith("//")) {
      normalized = `https:${normalized}`;
    } else {
      normalized = `https://${normalized}`;
    }
  }

  try {
    const parsed = new URL(normalized);
    const encodedPath = parsed.pathname
      .split("/")
      .map((segment) => {
        if (!segment) return segment;
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch (_error) {
          return encodeURIComponent(segment);
        }
      })
      .join("/");
    parsed.pathname = encodedPath;
    return parsed.toString();
  } catch (_error) {
    return encodeURI(normalized);
  }
};

const normalizeMediaArray = (mediaList = []) => {
  if (!Array.isArray(mediaList)) return [];
  return mediaList.map((media) => ensurePublicMediaUrl(media)).filter(Boolean);
};

const isLikelyVideoUrl = (url = "") =>
  /\.(mp4|mov|webm|ogg|m3u8)(\?|$)/i.test(url) || /\/video\//i.test(String(url));

async function checkFormCreateOrNot(businessId, adTypeId, internalCampiagnId) {
  try {
    const check = await leadFormModel.findOne({
      businessId,
      adTypeId,
      internalCampiagnId,
    });
    let count = await leadFormModel.countDocuments({ businessId, adTypeId });
    return { check: check || null, count };
  } catch (error) {
    console.error("Error checking form creation:", error);
    throw error;
  }
}

async function fetchClientUserId(accessToken) {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v22.0/me?access_token=${accessToken}`,
    );
    return response.data.id;
  } catch (error) {
    console.error("Error fetching client user ID:", error);
    throw error;
  }
}

/**
 * Smart Meta Creative Discovery System
 * Searches for creatives (video/image) across hierarchy if primary ID is stale/wrong
 */
async function discoverMetaCreative(id, adAccountId, accessToken) {
  if (!id || !accessToken) return null;
  console.log(`[Discovery] Starting search for ID: ${id} in Account: ${adAccountId}`);
  
  try {
    let creative = null;
    let discoveredAdId = null;

    // 1. Try Direct Ad Fetch
    const adRes = await axios.get(`https://graph.facebook.com/v22.0/${id}?fields=id,creative{id,image_url,thumbnail_url,video_id,effective_object_story_id}&access_token=${accessToken}`).catch(() => null);
    if (adRes?.data?.creative) {
      console.log(`[Discovery] Found direct creative for ID ${id}`);
      creative = adRes.data.creative;
      discoveredAdId = adRes.data.id;
    }

    // 2. Try as AdSet / Campaign (Fetch child Ads)
    if (!creative) {
      const childrenRes = await axios.get(`https://graph.facebook.com/v22.0/${id}/ads?fields=id,creative{id,image_url,thumbnail_url,video_id,effective_object_story_id}&limit=1&access_token=${accessToken}`).catch(() => null);
      if (childrenRes?.data?.data?.[0]?.creative) {
        console.log(`[Discovery] Found child creative for ID ${id} (adset/campaign)`);
        creative = childrenRes.data.data[0].creative;
        discoveredAdId = childrenRes.data.data[0].id;
      }
    }

    // 3. Fallback: Search latest ads in the account (DISABLED as it shows incorrect data to users)
    /*
    if (!creative && adAccountId) {
      const cleanAccountId = adAccountId.replace('act_', '');
      const accountAdsRes = await axios.get(`https://graph.facebook.com/v22.0/act_${cleanAccountId}/ads?fields=id,creative{id,image_url,thumbnail_url,video_id,effective_object_story_id}&limit=5&access_token=${accessToken}`).catch(() => null);
      const bestMatch = accountAdsRes?.data?.data?.find(a => a.creative?.video_id) || accountAdsRes?.data?.data?.[0];
      if (bestMatch?.creative) {
        console.log(`[Discovery] Falling back to account ad: ${bestMatch.id}`);
        creative = bestMatch.creative;
        discoveredAdId = bestMatch.id;
      }
    }
    */

    if (creative) {
      let videoSource = null;
      let previewUrl = null;
      
      // 1. Fetch Secure Source MP4 for native fallback
      if (creative.video_id) {
         const vRes = await axios.get(`https://graph.facebook.com/v22.0/${creative.video_id}?fields=source&access_token=${accessToken}`).catch(() => null);
         videoSource = vRes?.data?.source;
      }

      // 2. Fetch Official Ad Preview (Best for WebView)
      const pRes = await axios.get(`https://graph.facebook.com/v22.0/${discoveredAdId}/previews?ad_format=MOBILE_FEED_STANDARD&access_token=${accessToken}`).catch(() => null);
      const previewHtml = pRes?.data?.data?.[0]?.body;
      if (previewHtml) {
        // Extract src="..." from the iframe tag
        const match = previewHtml.match(/src="([^"]+)"/);
        if (match && match[1]) {
           previewUrl = match[1].replace(/&amp;/g, '&');
        }
      }

      return { creative, discoveredAdId, videoSource, previewUrl };
    }
    
    return null;
  } catch (err) {
    console.warn(`[Discovery] Failed for ${id}:`, err.message);
    return null;
  }
}

// Location → Meta geo converter: convertLocationToMetaGeo / fixParseAndConvertLocationString (near file end)

async function logMetaError({
  businessId,
  internalCampaignId,
  metaCampaignId,
  metaAdSetId,
  errorType,
  error,
}) {
  try {
    console.log(internalCampaignId, "internalCampaignId");
    await AdErrorLog.create({
      businessId,
      internalCampaignId,
      metaCampaignId,
      metaAdSetId,
      errorType,
      errorMessage: formatMetaAxiosError(error),
      errorDetails: error.response?.data || {},
      createdAt: new Date(),
    });
    console.info(`Meta API error logged: ${errorType}`);
  } catch (dbError) {
    console.error("Failed to log Meta API error:", dbError.message);
  }
}

async function createFacebookCampaign(
  name,
  businessData,
  adTypeId,
  adKind,
  outcomeType,
  destinationUrl,
  application_id,
  session,
  internalCampaign,
) {
  const validOutcomes = [
    "OUTCOME_AWARENESS",
    "OUTCOME_ENGAGEMENT",
    "OUTCOME_SALES",
    "APP_INSTALLS",
    "OUTCOME_LEADS",
    "OUTCOME_TRAFFIC",
  ];
  if (!validOutcomes.includes(outcomeType)) {
    throw new Error(
      `Invalid outcome type. Must be one of: ${validOutcomes.join(", ")}`,
    );
  }

  let leadFormId = null;
  let fromName = "";
  if (adKind === AD_KIND.LEAD_FORM) {
    let check = await getFormId(
      businessData,
      adTypeId,
      session,
      internalCampaign,
    );
    leadFormId = check?.leadFormId;
    fromName = check?.fromName;
  }

  const apiUrl = `https://graph.facebook.com/v22.0/${process.env.adAccountId}/campaigns`;
  // Start PAUSED — admin approve flips Meta objects to ACTIVE (CC go-live policy).
  // Meta requires is_adset_budget_sharing_enabled when not using campaign budget (CBO).
  const payload = {
    name,
    objective:
      outcomeType === "APP_INSTALLS" ? "OUTCOME_APP_PROMOTION" : outcomeType,
    access_token: process.env.systemUserAccessToken,
    status: "PAUSED",
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  };

  try {
    console.info("Creating Facebook campaign with payload:", payload);
    const response = await axios.post(apiUrl, payload);
    console.info("Facebook campaign created successfully:", response.data);

    const data = await ExternalCampaignsModel.create(
      [
        {
          meta_CampaignId: response.data.id,
          name,
          objective: outcomeType,
          status: "PAUSED",
          businessId: businessData._id,
          adTypeId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      { session },
    );
    await internalCampaignModel.findByIdAndUpdate(
      { _id: internalCampaign },
      { $set: { fromName: fromName } },
      { new: true },
    );
    console.info("Campaign saved to database:", data[0]);
    return { data: data[0], leadFormId };
  } catch (error) {
    await logMetaError({
      businessId: businessData._id,
      errorType: "CAMPAIGN_CREATION",
      error,
      internalCampaignId: internalCampaign,
    });
    return { data: null, leadFormId, error: formatMetaAxiosError(error) };
  }
}

async function getFormId(businessData, addTypeId, session, internalCampaign) {
  try {
    let checkLeadForm = await checkFormCreateOrNot(
      businessData?._id,
      addTypeId,
      internalCampaign,
    );
    if (!checkLeadForm?.check) {
      if (!businessData?.pageId || !businessData?.pageAccessToken) {
        throw new Error("Missing required page data or access token");
      }
      let fromName =
        `${businessData.businessName}__${checkLeadForm.count}__${internalCampaign}`.substring(
          0,
          60,
        );
      const apiUrl = `https://graph.facebook.com/v22.0/${businessData.pageId}/leadgen_forms`;
      const formData = {
        name: fromName,
        locale: "en_US",
        questions: [
          { type: "FULL_NAME", key: "full_name" },
          { type: "EMAIL", key: "email" },
          { type: "PHONE", key: "phone_number" },
        ],
        privacy_policy: {
          url: "https://www.freeprivacypolicy.com/live/58f3de93-84fc-4b26-95ae-ff312f7bf298",
          link_text: "Our Privacy Policy",
        },
        follow_up_action_url: "https://leadkart.in",
      };

      const response = await axios.post(apiUrl, formData, {
        params: { access_token: businessData.pageAccessToken },
        headers: { "Content-Type": "application/json" },
      });

      const leadFormId = response.data.id;
      await leadFormModel.create(
        [
          {
            fromName: fromName,
            formId: leadFormId,
            adTypeId: addTypeId,
            pageId: businessData.pageId,
            businessId: businessData._id,
            internalCampiagnId: internalCampaign,
          },
        ],
        { session },
      );
      return { leadFormId, fromName };
    }
    return {
      leadFormId: checkLeadForm?.check?.formId || null,
      fromName: checkLeadForm?.check?.fromName || "",
    };
  } catch (error) {
    await logMetaError({
      businessId: businessData._id,
      errorType: "LEAD_FORM",
      error,
      internalCampaignId: internalCampaign,
    });
    return null;
  }
}

async function addCreativeImg(
  businessData,
  imgLocation,
  page_id,
  leadFormId,
  addTypeId,
  destinationUrl,
  caption,
  advertisementType,
  internalCampaign,
  headline,
  primaryText,
) {
  // Kind, not id: the creative's CTA must follow what the ad type does.
  const adKind = kindFromAdvertisementType(advertisementType);
  let filePath;
  try {
    const fileUrl = imgLocation;
    const fileName = path.basename(fileUrl);
    filePath = path.resolve(__dirname, fileName);

    const response = await axios({
      url: fileUrl,
      method: "GET",
      responseType: "stream",
    });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.info("Image downloaded successfully:", filePath);

    const formdata = new FormData();
    const fileStream = fs.createReadStream(filePath);
    formdata.append("filename", fileStream);
    formdata.append(
      "access_token",
      getMetaAccessToken(),
    );

    const requestOptions = { headers: formdata.getHeaders() };
    const apiResponse = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.adAccountId}/adimages`,
      formdata,
      requestOptions,
    );

    const hashKey = Object.values(apiResponse.data.images)[0].hash;
    console.info("Image uploaded to Facebook successfully:", hashKey);

    let obj;
    if (leadFormId) {
      obj = {
        call_to_action: {
          type: "LEARN_MORE",
          value: { lead_gen_form_id: leadFormId },
        },
        image_hash: hashKey,
        link: "http://fb.me/",
        message: primaryText || "Get your free quote today!",
        name: headline || "Your Headline Here", // Headline (max 40 chars)
        description: caption || "Your Description Here", // Description (optional, max 30 chars)
      };
    } else if (adKind === AD_KIND.WHATSAPP) {
      const waLink = buildWhatsAppCtaLink(
        businessData?._effectiveWhatsApp || businessData?.whatsappNumber,
      );
      obj = {
        call_to_action: {
          type: "WHATSAPP_MESSAGE",
          value: { link: waLink },
        },
        image_hash: hashKey,
        link: waLink,
        message: primaryText || "Get your free quote today!",
        name: headline || "Your Headline Here",
        description: caption || "Your Description Here",
      };
    } else if (adKind === AD_KIND.CALL) {
      obj = {
        call_to_action: {
          type: "LEARN_MORE",
          value: { link: destinationUrl },
        },
        image_hash: hashKey,
        link: "http://fb.me/",
        message: primaryText || "Get your free quote today!",
        name: headline || "Your Headline Here", // Headline (max 40 chars)
        description: caption || "Your Description Here", // Description (optional, max 30 chars)
      };
    } else if (advertisementType === "APP_INSTALLS") {
      obj = {
        call_to_action: {
          type: "INSTALL_MOBILE_APP",
          value: { link: destinationUrl },
        },
        link: destinationUrl,
        message: primaryText || "Download our app now!",
        name: headline || "Your Headline Here", // Headline (max 40 chars)
        description: caption || "Your Description Here", // Description (optional, max 30 chars)
        image_hash: hashKey,
      };
    } else if (kindFromAdvertisementType(advertisementType) === AD_KIND.TRAFFIC) {
      obj = {
        call_to_action: {
          type: "SEE_MORE",
          value: { link: destinationUrl },
        },
        link: destinationUrl,
        message: primaryText || "Limited-time offer! Buy now!",
        name: headline || "Your Headline Here", // Headline (max 40 chars)
        description: caption || "Your Description Here", // Description (optional, max 30 chars)
        image_hash: hashKey,
      };
    } else if (advertisementType === "OUTCOME_SALES") {
      obj = {
        call_to_action: {
          type: "BUY_NOW",
          value: { link: destinationUrl },
        },
        link: destinationUrl,
        message: primaryText || "Limited-time offer! Buy now!",
        name: headline || "Your Headline Here", // Headline (max 40 chars)
        description: caption || "Your Description Here", // Description (optional, max 30 chars)
        image_hash: hashKey,
      };
    } else if (advertisementType === "OUTCOME_ENGAGEMENT") {
      obj = {
        call_to_action: {
          type: "LIKE_PAGE",
          value: { link: destinationUrl },
        },
        link: destinationUrl,
        message: primaryText || "Limited-time offer! Buy now!",
        name: headline || "Your Headline Here", // Headline (max 40 chars)
        description: caption || "Your Description Here", // Description (optional, max 30 chars)
        image_hash: hashKey,
      };
    } else if (advertisementType === "OUTCOME_AWARENESS") {
      obj = {
        call_to_action: {
          type: "SEE_MORE",
          value: { link: destinationUrl },
        },
        link: destinationUrl,
        message: primaryText || "Limited-time offer! Buy now!",
        name: headline || "Your Headline Here", // Headline (max 40 chars)
        description: caption || "Your Description Here", // Description (optional, max 30 chars)
        image_hash: hashKey,
      };
    }

    const objectStorySpec = { page_id, link_data: obj };
    const payload = {
      name: businessData.businessName,
      object_story_spec: objectStorySpec,
      access_token:
        getMetaAccessToken(),
    };

    const finalRes = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.adAccountId}/adcreatives`,
      payload,
    );

    console.info("Ad Creative Created Successfully:", finalRes.data);
    return { id: finalRes.data.id, hashKey };
  } catch (error) {
    await logMetaError({
      businessId: businessData._id,
      errorType: "CREATIVE_UPLOAD",
      error,
      internalCampaignId: internalCampaign,
    });
    return { id: null, hashKey: null, error: error.message };
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.info("Temporary file deleted:", filePath);
    }
  }
}

async function addCreativeMultiImg(
  businessData,
  imgLocation,
  page_id,
  leadFormId,
  addTypeId,
  destinationUrl,
  caption,
  advertisementType,
  internalCampaign,
  headline,
  primaryText,
) {
  // Kind, not id: the creative's CTA must follow what the ad type does.
  const adKind = kindFromAdvertisementType(advertisementType);
  let filePath;
  let tempFiles = [];
  try {
    console.log("imgLocations", imgLocation);

    // Upload all images first
    const uploadPromises = imgLocation.map(async (imgLocation) => {
      const fileUrl = imgLocation;
      const fileName = path.basename(fileUrl);
      const filePath = path.resolve(__dirname, fileName);
      tempFiles.push(filePath);

      // Download the image
      const response = await axios({
        url: fileUrl,
        method: "GET",
        responseType: "stream",
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.info("Image downloaded successfully:", filePath);

      // Upload to Facebook
      const formdata = new FormData();
      const fileStream = fs.createReadStream(filePath);
      formdata.append("filename", fileStream);
      formdata.append(
        "access_token",
        getMetaAccessToken(),
      );

      const requestOptions = { headers: formdata.getHeaders() };
      const apiResponse = await axios.post(
        `https://graph.facebook.com/v22.0/${process.env.adAccountId}/adimages`,
        formdata,
        requestOptions,
      );

      const hashKey = Object.values(apiResponse.data.images)[0].hash;
      console.info("Image uploaded to Facebook successfully:", hashKey);
      return hashKey;
    });

    // Wait for all images to upload and get their hashes
    var imageHashes = await Promise.all(uploadPromises);
    console.log("All images uploaded successfully:", imageHashes);
    // const imageHashes = [
    //   "0bb4fbf2cf32ede42ab11fea438207fd",
    //   "82de4aa72782f852fee6edea6d536862",
    // ];

    // Base structure for all ad types
    const baseAdStructure = {
      page_id: page_id, // Required for all ad types
      link_data: {
        link: destinationUrl,
        child_attachments: imageHashes.map((hash) => ({
          image_hash: hash,
          link: destinationUrl,
        })),
      },
    };

    // Customize based on advertisement type
    let objectStorySpec;

    if (leadFormId) {
      objectStorySpec = {
        ...baseAdStructure,
        link_data: {
          ...baseAdStructure.link_data,
          message: primaryText || "Get your free quote today!",
          // name: "Your Main Headline", // Headline (max 40 chars)
          // description: "Your Main Description", // Description (max 30 chars, optional)
          call_to_action: {
            type: "LEARN_MORE",
            value: { lead_gen_form_id: leadFormId },
          },
          child_attachments: baseAdStructure.link_data.child_attachments.map(
            (att) => ({
              ...att,
              description: caption || "Learn more about our offer!",
              name: headline || "Your Main Headline",
            }),
          ),
        },
      };
    } else if (adKind === AD_KIND.WHATSAPP) {
      const waLink = buildWhatsAppCtaLink(
        businessData?._effectiveWhatsApp || businessData?.whatsappNumber,
      );
      objectStorySpec = {
        ...baseAdStructure,
        link_data: {
          ...baseAdStructure.link_data,
          link: waLink,
          message: primaryText || "Get your free quote today!",
          call_to_action: {
            type: "WHATSAPP_MESSAGE",
            value: { link: waLink },
          },
          child_attachments: baseAdStructure.link_data.child_attachments.map(
            (att) => ({
              ...att,
              link: waLink,
              description: caption || "Learn more about our offer!",
              name: headline || "Your Main Headline",
            }),
          ),
        },
      };
    } else if (adKind === AD_KIND.CALL) {
      objectStorySpec = {
        ...baseAdStructure,
        link_data: {
          ...baseAdStructure.link_data,
          message: primaryText || "Get your free quote today!",
          // name: "Your Main Headline", // Headline (max 40 chars)
          // description: "Your Main Description", // Description (max 30 chars, optional)
          call_to_action: {
            type: "LEARN_MORE",
            value: { link: destinationUrl },
          },
          child_attachments: baseAdStructure.link_data.child_attachments.map(
            (att) => ({
              ...att,
              description: caption || "Learn more about our offer!",
              name: headline || "Your Main Headline",
            }),
          ),
        },
      };
    } else if (advertisementType === "APP_INSTALLS") {
      objectStorySpec = {
        ...baseAdStructure,
        link_data: {
          ...baseAdStructure.link_data,
          message: primaryText || "Download our app now!",
          // name: "Your Main Headline", // Headline (max 40 chars)
          // description: "Your Main Description", // Description (max 30 chars, optional)
          call_to_action: {
            type: "INSTALL_MOBILE_APP",
            value: {
              link: destinationUrl,
              app_link: destinationUrl, // For deep linking
            },
          },
          child_attachments: baseAdStructure.link_data.child_attachments.map(
            (att) => ({
              ...att,
              description: caption || "Install our app today!",
              name: headline || "Your Main Headline",
            }),
          ),
        },
      };
    } else if (kindFromAdvertisementType(advertisementType) === AD_KIND.TRAFFIC) {
      objectStorySpec = {
        ...baseAdStructure,
        link_data: {
          ...baseAdStructure.link_data,
          message: primaryText || "Visit our website now!",
          // name: "Your Main Headline", // Headline (max 40 chars)
          // description: "Your Main Description", // Description (max 30 chars, optional)
          call_to_action: {
            type: "LEARN_MORE", // "SEE_MORE" is deprecated
            value: { link: destinationUrl },
          },
          child_attachments: baseAdStructure.link_data.child_attachments.map(
            (att) => ({
              ...att,
              description: caption || "Click to visit our site!",
              name: headline || "Your Main Headline",
            }),
          ),
        },
      };
    } else if (advertisementType === "OUTCOME_SALES") {
      objectStorySpec = {
        ...baseAdStructure,
        link_data: {
          ...baseAdStructure.link_data,
          message: primaryText || "Limited-time offer! Buy now!",
          // name: "Your Main Headline", // Headline (max 40 chars)
          // description: "Your Main Description", // Description (max 30 chars, optional)
          call_to_action: {
            type: "SHOP_NOW", // "BUY_NOW" is deprecated
            value: { link: destinationUrl },
          },
          child_attachments: baseAdStructure.link_data.child_attachments.map(
            (att) => ({
              ...att,
              description: caption || "Shop now and save!",
              name: headline || "Your Main Headline",
            }),
          ),
        },
      };
    } else if (advertisementType === "OUTCOME_ENGAGEMENT") {
      objectStorySpec = {
        ...baseAdStructure,
        link_data: {
          ...baseAdStructure.link_data,
          message: primaryText || "Check out our latest update!",
          // name: "Your Main Headline", // Headline (max 40 chars)
          // description: "Your Main Description", // Description (max 30 chars, optional)
          child_attachments: baseAdStructure.link_data.child_attachments.map(
            (att) => ({
              ...att,
              description: caption || "Like our page for updates!",
              name: headline || "Your Main Headline",
            }),
          ),
        },
      };
    } else if (advertisementType === "OUTCOME_AWARENESS") {
      objectStorySpec = {
        ...baseAdStructure,
        link_data: {
          ...baseAdStructure.link_data,
          message: primaryText || "Discover our brand!",
          // // Headline (max 40 chars)
          //   description: "Your Main Description", // Description (max 30 chars, optional)
          call_to_action: {
            type: "LEARN_MORE",
            value: { link: destinationUrl },
          },
          child_attachments: baseAdStructure.link_data.child_attachments.map(
            (att) => ({
              ...att,
              name: headline || "Your Main Headline",
              description: caption || "Discover our brand!",
            }),
          ),
        },
      };
    }

    const payload = {
      name: businessData.businessName,
      object_story_spec: objectStorySpec,
      access_token:
        getMetaAccessToken(),
    };

    // try {
    const finalRes = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.adAccountId}/adcreatives`,
      payload,
    );
    console.log("Ad creative created successfully:", finalRes.data);
    // } catch (error) {
    //   console.error("Error creating ad creative:", error.response?.data || error.message);
    // }
    console.info("Ad Creative Created Successfully:", finalRes.data);
    return { id: finalRes.data.id, hashKey: imageHashes };
  } catch (error) {
    await logMetaError({
      businessId: businessData._id,
      errorType: "CREATIVE_UPLOAD",
      error,
      internalCampaignId: internalCampaign,
    });
    return { id: null, hashKey: null, error: error.message };
  } finally {
    // if (filePath && fs.existsSync(filePath)) {
    //   fs.unlinkSync(filePath);
    //   console.info("Temporary file deleted:", filePath);
    // }
  }
}

async function addCreativeVideo(
  businessData,
  videoLocation,
  page_id,
  leadFormId,
  addTypeId,
  destinationUrl,
  caption,
  advertisementType,
  internalCampaign,
  thambnail,
  headline,
  primaryText,
) {
  // Kind, not id: the creative's CTA must follow what the ad type does.
  const adKind = kindFromAdvertisementType(advertisementType);
  let filePath;
  try {
    if (thambnail) {
      const fileUrl = thambnail;
      const fileName = path.basename(fileUrl);
      filePath = path.resolve(__dirname, fileName);

      const response = await axios({
        url: fileUrl,
        method: "GET",
        responseType: "stream",
      });
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.info("Image downloaded successfully:", filePath);

      const formdata = new FormData();
      const fileStream = fs.createReadStream(filePath);
      formdata.append("filename", fileStream);
      formdata.append(
        "access_token",
        getMetaAccessToken(),
      );

      const requestOptions = { headers: formdata.getHeaders() };
      const apiResponse = await axios.post(
        `https://graph.facebook.com/v22.0/${process.env.adAccountId}/adimages`,
        formdata,
        requestOptions,
      );

      var hashKey = Object.values(apiResponse.data.images)[0].hash;
      console.info("Image uploaded to Facebook successfully:", hashKey);
    }

    if (videoLocation) {
      // // 1. Download the video
      console.log("videoLocation", videoLocation);
      const fileUrl = videoLocation;
      const fileName = path.basename(fileUrl);
      filePath = path.resolve(__dirname, fileName);

      const response = await axios({
        url: fileUrl,
        method: "GET",
        responseType: "stream",
      });
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.info("Video downloaded successfully:", filePath);

      // 2. Upload video to Facebook
      const formdata = new FormData();
      const fileStream = fs.createReadStream(filePath);
      formdata.append("source", fileStream);
      formdata.append(
        "access_token",
        getMetaAccessToken(),
      );

      const uploadResponse = await axios.post(
        `https://graph-video.facebook.com/v21.0/${process.env.adAccountId}/advideos`,
        formdata,
        {
          headers: formdata.getHeaders(),
          // maxContentLength: Infinity,
          // maxBodyLength: Infinity
        },
      );

      var videoId = uploadResponse.data.id || 1372784820829306;
      console.info("Video uploaded to Facebook successfully. ID:", videoId);
    }

    // 3. Create video ad creative
    let videoData = {
      video_id: videoId,
      message: primaryText || "Check out our video!",
      title: headline || "Your Video Title", // Title (max 40 chars)
      image_hash: hashKey || "0bb4fbf2cf32ede42ab11fea438207fd",
    };

    // Add call-to-action based on advertisement type
    switch (advertisementType) {
      case "APP_INSTALLS":
        videoData.call_to_action = {
          type: "INSTALL_MOBILE_APP",
          value: {
            link: destinationUrl,
          },
        };
        break;
      case "OUTCOME_TRAFFIC":
        videoData.call_to_action = {
          type: "SEE_MORE",
          value: {
            link: destinationUrl,
          },
        };
        break;
      case "OUTCOME_SALES":
        videoData.call_to_action = {
          type: "BUY_NOW",
          value: {
            link: destinationUrl,
          },
        };
        break;
      case "OUTCOME_ENGAGEMENT":
        videoData.call_to_action = {
          type: "LIKE_PAGE",
          value: {
            link: destinationUrl,
          },
        };
        break;
      case "OUTCOME_AWARENESS":
      default:
        videoData.call_to_action = {
          type: "LEARN_MORE",
          value: {
            link: destinationUrl,
          },
        };
    }

    // Handle lead forms differently
    if (leadFormId) {
      videoData.call_to_action = {
        type: "LEARN_MORE",
        value: { lead_gen_form_id: leadFormId },
      };
    }
    if (adKind === AD_KIND.WHATSAPP) {
      const waLink = buildWhatsAppCtaLink(
        businessData?._effectiveWhatsApp || businessData?.whatsappNumber,
      );
      videoData.call_to_action = {
        type: "WHATSAPP_MESSAGE",
        value: {
          link: waLink,
        },
      };
    }
    if (adKind === AD_KIND.CALL) {
      videoData.call_to_action = {
        type: "LEARN_MORE",
        value: {
          link: destinationUrl,
        },
      };
    }
    const objectStorySpec = {
      page_id: page_id,
      video_data: videoData,
    };

    const payload = {
      name: `${businessData.businessName}`,
      object_story_spec: objectStorySpec,
      access_token:
        getMetaAccessToken(),
    };

    // 4. Create the video ad creative
    const finalRes = await axios.post(
      `https://graph.facebook.com/v21.0/${process.env.adAccountId}/adcreatives`,
      payload,
    );

    console.info("Video Ad Creative Created Successfully:", finalRes.data);
    return { id: finalRes.data.id, videoId, hashKey };
  } catch (error) {
    await logMetaError({
      businessId: businessData._id,
      errorType: "CREATIVE_UPLOAD",
      error,
      internalCampaignId: internalCampaign,
    });
    return { id: null, videoId: null, error: error.message };
  } finally {
    // if (filePath && fs.existsSync(filePath)) {
    //   fs.unlinkSync(filePath);
    //   console.info("Temporary video file deleted:", filePath);
    // }
  }
}

async function createFacebookAdSet(
  name,
  optimization_goal,
  billing_event,
  startDate,
  endDate,
  dailyBudget,
  targeting,
  campaignId,
  days,
  dayStartTime,
  dayEndTime,
  application_id,
  destinationUrl,
  session,
  internalCampaign,
  businessId,
  targetingAutomation = 1,
  promotedObject = null,
  destinationType = null,
) {
  try {
    const apiUrl = `https://graph.facebook.com/v22.0/${process.env.adAccountId}/adsets`;
    console.info("Creating Facebook Ad Set with data:", {
      name,
      optimization_goal,
      billing_event,
      startDate,
      endDate,
      dailyBudget,
      targeting,
      campaignId,
      days,
      dayStartTime,
      dayEndTime,
      application_id,
      destinationUrl,
      internalCampaign,
      promotedObject,
      destinationType,
    });

    const basePayload = {
      name,
      optimization_goal,
      billing_event,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      start_time: startDate,
      end_time: endDate,
      daily_budget: dailyBudget,
      targeting,
      campaign_id: campaignId,
      status: "PAUSED",
      access_token: process.env.systemUserAccessToken,
    };

    // Meta expects adset_schedule + pacing_type day_parting (never day_parting/"HH:MM")
    const schedule = buildMetaAdSetSchedule(days, dayStartTime, dayEndTime);
    if (schedule) {
      basePayload.adset_schedule = schedule;
      basePayload.pacing_type = ["day_parting"];
    }

    if (destinationType) {
      basePayload.destination_type = destinationType;
    }

    let obj = basePayload;
    if (promotedObject && Object.keys(promotedObject).length) {
      obj = { ...basePayload, promoted_object: promotedObject };
    } else if (application_id) {
      obj = {
        ...basePayload,
        promoted_object: {
          application_id,
          object_store_url: destinationUrl,
        },
      };
    }

    const response = await axios.post(apiUrl, obj);
    console.info("Facebook Ad Set Created Successfully:", response.data);
    return response.data;
  } catch (error) {
    await logMetaError({
      businessId: businessId,
      metaCampaignId: campaignId,
      errorType: "ADSET_CREATION",
      error,
      internalCampaignId: internalCampaign,
    });
    return {
      id: null,
      error: formatMetaAxiosError(error),
    };
  }
}

async function createAd(
  name,
  adsetId,
  creativeId,
  accessToken,
  session,
  businessId,
  internalCampaign,
) {
  try {
    const apiUrl = `https://graph.facebook.com/v22.0/${process.env.adAccountId}/ads`;
    const payload = {
      name,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: "PAUSED",
      access_token: accessToken,
    };

    console.info("API URL:", apiUrl);
    console.info("Payload:", payload);

    const response = await axios.post(apiUrl, payload);
    console.info("Ad Created Successfully:", response.data);
    return response.data;
  } catch (error) {
    console.log(internalCampaign, "internalCampaign");
    await logMetaError({
      businessId: businessId,
      metaAdSetId: adsetId,
      errorType: "AD_CREATION",
      error,
      internalCampaignId: internalCampaign,
    });
    return {
      id: null,
      error: formatMetaAxiosError(error),
    };
  }
}

async function processAdCreation({
  businessId,
  name,
  optimization_goal,
  billing_event,
  remainingBalance,
  totalBudget,
  transactionId,
  externalCampiagnId,
  imageId,
  caption,
  callToActionId,
  audienceId,
  interest,
  location,
  audienceGender,
  ageRangeFrom,
  ageRangeTo,
  days,
  planId,
  facebookBudget,
  instaBudget,
  googleBudget,
  facebookBalance,
  instaBalance,
  googleBalance,
  dailySpendLimit,
  balanceAmount,
  startDate,
  endDate,
  dayStartTime,
  dayEndTime,
  isFacebookAdEnabled,
  isInstaAdEnabled,
  isGoogleAdEnabled,
  addTypeId,
  destinationUrl,
  aaplicationId,
  platforms,
  fileLocation,
  thambnail,
  type,
  headline,
  primaryText,
  adtype,
  mobileNumber,
  advantageAudienceEnabled,
  dailyBudget: clientDailyBudgetRupees,
}) {
  console.log("processAdCreation called with:");
  const session = await mongoose.startSession();
  session.startTransaction();
  let trackedInternalCampaignId = null;

  try {
    // Input validation
    if (!businessId) throw new Error("businessId is required");
    if (!interest) throw new Error("interest is required");
    if (!location) throw new Error("location is required");

    const businessData = await businessModel
      .findById(businessId)
      .select("metaAccessToken pageAccessToken pageId businessName pageName whatsappNumber")
      .session(session);
    if (!businessData) throw new Error("Business not found");
    if (!businessData.pageId) {
      throw new Error(
        "Facebook Page is not linked. Link your Page in Business settings before creating ads.",
      );
    }

    // Resolved before any Meta call so every downstream branch (objective, lead
    // form, CTA, ad set destination) agrees on what this ad is supposed to do.
    const findAddTypeId = await advertisementModel
      .findById(addTypeId)
      .session(session);
    if (!findAddTypeId) throw new Error("Invalid advertisement type");
    const adKind = kindFromAdvertisementType(findAddTypeId.advertisementType);

    if (adKind === AD_KIND.LEAD_FORM && !businessData.pageAccessToken) {
      throw new Error(
        "Page access token missing. Re-link your Facebook Page to create Lead Form ads.",
      );
    }

    const clientUserId = businessData?.pageName
      ? businessData?.pageName
      : await fetchClientUserId(businessData.pageAccessToken);
    console.log("clientUserId", clientUserId);
    const planData = planId
      ? await planModel.findById(planId).session(session)
      : null;
    // Parse interest and location
    const cleanedInterest = interest.replace(/\\/g, "");
    const parsedInterest = JSON.parse(cleanedInterest);
    const parsedLocation = await fixParseAndConvertLocationString(location);
    if (!parsedLocation || !hasUsableGeoTarget(parsedLocation)) {
      throw new Error(
        "Target area is required. Select at least one location on the map and retry.",
      );
    }
    if (!Array.isArray(parsedInterest) || !parsedInterest.length) {
      throw new Error(
        "At least one interest is required. Select interests and retry.",
      );
    }

    let parsedDays = Array.isArray(days) ? days : [];
    if (typeof days === 'string') {
      try { parsedDays = JSON.parse(days.replace(/\\/g, "")); } catch(e) { parsedDays = []; }
    }

    let parsedGender = Array.isArray(audienceGender) ? audienceGender : [];
    if (typeof audienceGender === 'string') {
      try { parsedGender = JSON.parse(audienceGender.replace(/\\/g, "")); } catch(e) { parsedGender = []; }
    }
    // Assume these variables are passed or defined elsewhere
    let planDatas = planData || {}; // Fallback to empty object if planData is null/undefined
    const facebookBudge = facebookBudget || 0; // Fallback to 0 if undefined
    const instaBudge = instaBudget || 0; // Fallback to 0 if undefined

    console.log("facebookBudget:", facebookBudge);

    // Calculate GST (18%) for Facebook budget
    let bugetFace = Number(planDatas.facebookBudget || facebookBudge || 0);
    let bugetInsta = Number(planDatas.instaBudget || instaBudge || 0);
    totalBudget = bugetFace + bugetInsta;
    const facebookGst =
      Number(planDatas.facebookBudget || facebookBudge || 0) * 0.18;
    console.log("facebookGst:", facebookGst);

    // Calculate GST (18%) for Instagram budget
    const instaGst = Number(planDatas.instaBudget || instaBudge || 0) * 0.18;
    console.log("instaGst:", instaGst);

    // Calculate net budgets (before GST, assuming GST is deducted)
    const facebookBudgets =
      Number(planDatas.facebookBudget || facebookBudge || 0) - facebookGst;
    const instaBudgets =
      Number(planDatas.instaBudget || instaBudge || 0) - instaGst;

    console.log("facebookBudgets (net):", facebookBudgets);
    console.log("instaBudgets (net):", instaBudgets);
    const sanitizedFileLocation = normalizeMediaArray(
      Array.isArray(fileLocation) ? fileLocation : [fileLocation],
    );
    const sanitizedThumbnail = ensurePublicMediaUrl(thambnail);

    // Create internal campaign
    const internalCampaignData = await internalCampaignModel.create(
      [
        {
          totalBudget,
          businessId,
          title: name,
          imageId,
          caption,
          callToActionId,
          destinationUrl,
          audienceId,
          interest: parsedInterest,
          location: parsedLocation,
          audienceGender: parsedGender,
          ageRangeFrom,
          ageRangeTo,
          days: parsedDays,
          startDate: new Date(startDate * 1000).toUTCString(),
          endDate: new Date(endDate * 1000).toUTCString(),
          planId,
          facebookBudget: facebookBudgets,
          instaBudget: instaBudgets,
          googleBudget: googleBudget || 0,
          facebookBalance,
          instaBalance,
          googleBalance,
          isFacebookAdEnabled,
          isInstaAdEnabled,
          isGoogleAdEnabled,
          dayEndTime,
          dayStartTime,
          addTypeId,
          image: sanitizedFileLocation,
          thambnail: sanitizedThumbnail,
          headline,
          primaryText,
          adtype,
          mobileNumber,
          pageName: clientUserId,
        },
      ],
      { session },
    );
    let tokens = [];

    let findAdmin = await userModel
      .findOne({ _id: "64ddafdb7f21b2c8878e0001", userType: "ADMIN" })
      .select("adminFcm");
    console.log("findAdmin", findAdmin);
    let notificationPayload = {
      title: `${businessData?.businessName} Create A New Ads On Lead kart`,
      description: "A new ad has been created.",
    };

    // अब आपके पास unique deviceId वाले fcm tokens हैं
    let fcmTokens = findAdmin?.adminFcm || [];
    // let
    // Notification भेजो
    sendNotificationToMultipleTokens(fcmTokens, notificationPayload);

    let amountWithGst = planData
      ? Math.ceil(
          (Number(planData.facebookBudget) || 0) +
            (Number(planData.instaBudget) || 0),
        )
      : Math.ceil((Number(facebookBudget) || 0) + (Number(instaBudget) || 0));

    let abs = await commpanyModel.findOne();
    const charges = computeAdChargeBreakdown(amountWithGst, abs);
    console.log("internalCampaignData?._id", internalCampaignData[0]?._id);
    trackedInternalCampaignId = internalCampaignData[0]?._id;

    const finalAmount = charges.total;
    let fid = await businessModel.findById(businessId);

    // What this ad actually cost. For a Razorpay-paid ad that is the verified
    // amount already charged, not this recomputed figure — otherwise the ledger
    // debit and the payment credit differ by the rounding between them.
    let adCost = finalAmount;
    if (transactionId && !transactionId.startsWith('wallet_') && !transactionId.startsWith('WAL_')) {
      const paidTxn = await Transaction.findOne({
        transactionId,
        type: "CREDIT",
      })
        .session(session)
        .lean();
      if (paidTxn && Number.isFinite(Number(paidTxn.amount))) {
        adCost = Number(paidTxn.amount);
      }
    } else {
      // Wallet payment: verify user has sufficient funds
      const currentUser = await userModel.findById(fid?.userId).session(session).lean();
      const currentWallet = Number(currentUser?.wallet) || 0;
      if (currentWallet < adCost) {
        throw new Error(
          `Insufficient wallet balance. Available: ₹${currentWallet.toLocaleString('en-IN')}, Required: ₹${adCost.toLocaleString('en-IN')}. Please top up your wallet or pay online.`
        );
      }
    }

    let transtion = {
      type: "DEBIT",
      amount: adCost,
      businessId: fid?._id,
      adsId: internalCampaignData[0]?._id,
      userId: fid?.userId,
      addTypeId: addTypeId,

      // gstAmount: 0,
      // serviceAmount: serviceAmount || 0,
      // paymentGetwayAmount: 0,
    };
    let internalTxId = await createTransaction(transtion, session);
    await generateInvoice(
      internalCampaignData,
      transactionId || internalTxId,
      facebookBudget,
      instaBudget,
      googleBudget,
    );

    console.log(transactionId || internalTxId, "transactionId");

    // 3. Deduct what this ad cost from the wallet.
    //
    // A Razorpay-paid ad is verified through POST /transactions as a CREDIT,
    // which puts the full amount into the wallet first. Skipping the debit here
    // (as this used to) meant the payment was banked and never spent: the ad
    // came out free and the wallet grew by the ad's price every time. So the
    // debit always runs — matched to the exact amount that was credited, so
    // the two cancel to zero instead of drifting by the rounding difference
    // between the app's total and this recomputed one.
    if (Number.isFinite(adCost) && adCost > 0) {
      await userModel.findByIdAndUpdate(
        fid?.userId,
        { $inc: { wallet: -adCost } },
        { session },
      );
    }

    const effectiveMobileNumber =
      mobileNumber || businessData?.whatsappNumber || null;
    // Creatives read this for WhatsApp CTA phone link
    if (businessData && typeof businessData === "object") {
      businessData._effectiveWhatsApp = effectiveMobileNumber;
    }

    if (
      adKind === AD_KIND.WHATSAPP &&
      !normalizeWhatsAppPhone(effectiveMobileNumber)
    ) {
      throw new Error(
        "WhatsApp number is required. Enter a valid number on the ad form or save it on the business profile.",
      );
    }

    // Map DB types (LEADS / WHATSAPP_MESSAGES) → Meta OUTCOME_* objectives
    const outcomeType = mapAdvertisementTypeToMetaOutcome(
      findAddTypeId?.advertisementType,
    );

    // Create Facebook campaign
    const externalCampiagnData = await createFacebookCampaign(
      name,
      businessData,
      addTypeId,
      adKind,
      outcomeType,
      destinationUrl,
      aaplicationId,
      session,
      internalCampaignData[0]?._id,
    );

    if (!externalCampiagnData?.data?.meta_CampaignId) {
      throw new Error(
        externalCampiagnData?.error ||
          "Meta campaign creation failed. Check ad account permissions and try again.",
      );
    }

    const start = new Date(startDate * 1000);
    const end = new Date(endDate * 1000);
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    const campaignId = externalCampiagnData.data?.meta_CampaignId?.toString();
    console.log(sanitizedThumbnail, "thambnail");
    // Create ad creative
    const normalizedMedia = sanitizedFileLocation;

    const primaryMedia = normalizedMedia[0] || null;

    const creativeData =
      type === "SingleImage"
        ? await addCreativeImg(
            businessData,
            primaryMedia,
            businessData?.pageId,
            externalCampiagnData.leadFormId,
            addTypeId,
            destinationUrl,
            caption,
            findAddTypeId?.advertisementType,
            internalCampaignData[0]?._id,
            headline,
            primaryText,
          )
        : type === "MultiImage"
          ? await addCreativeMultiImg(
              businessData,
              normalizedMedia,
              businessData?.pageId,
              externalCampiagnData.leadFormId,
              addTypeId,
              destinationUrl,
              caption,
              findAddTypeId?.advertisementType,
              internalCampaignData[0]?._id,
              headline,
              primaryText,
            )
          : type === "Video"
            ? await addCreativeVideo(
                businessData,
                primaryMedia,
                businessData?.pageId,
                externalCampiagnData.leadFormId,
                addTypeId,
                destinationUrl,
                caption,
                findAddTypeId?.advertisementType,
                internalCampaignData[0]?._id,
                sanitizedThumbnail,
                headline,
                primaryText,
              )
            : null; // Handle unknown types

    if (!creativeData?.id) {
      throw new Error(
        creativeData?.error ||
          "Meta ad creative creation failed. Check media, page permissions, and try again.",
      );
    }

    // Update internal campaign with creative and external campaign data
    console.log("creativeData", creativeData);
    var updatedInternalCampaign = await internalCampaignModel.findOneAndUpdate(
      { _id: internalCampaignData[0]._id },
      {
        $set: {
          imageHashId: creativeData?.hashKey,
          videoId: creativeData?.videoId,
          creativeId: creativeData?.id,
          externalCampiagnId: externalCampiagnData.data?._id,
          transactionId: transactionId || internalTxId,
          paymentStatus: (transactionId || internalTxId) ? "APPROVED" : "PENDING",
          // Never store campaign id as mainAdId — webhook/spend/admin ACTIVE need real ad id
        },
      },
      { new: true, session },
    );

    const requestedAgeMax = Number(ageRangeTo);
    const hasExplicitAdvantageSelection =
      typeof advantageAudienceEnabled === "boolean";
    const isAdvantageAudienceActive =
      (hasExplicitAdvantageSelection && advantageAudienceEnabled) ||
      (!hasExplicitAdvantageSelection && requestedAgeMax === 65);

    const effectiveAgeMax =
      isAdvantageAudienceActive && Number.isFinite(requestedAgeMax)
        ? Math.max(requestedAgeMax, 65)
        : ageRangeTo;

    if (
      isAdvantageAudienceActive &&
      Number.isFinite(requestedAgeMax) &&
      requestedAgeMax < 65
    ) {
      console.info(
        `Advantage+ audience enforces age_max >= 65. Requested max age ${requestedAgeMax} will be treated as a suggestion.`,
      );
    }

    const targetingAutomationOverrides = isAdvantageAudienceActive
      ? {
          targeting_automation: {
            advantage_audience: 1,
          },
        }
      : {
          targeting_automation: {
            advantage_audience: 0,
          },
        };

    if (!parsedLocation || !hasUsableGeoTarget(parsedLocation)) {
      throw new Error(
        "Target area is required. Select at least one location on the map and retry.",
      );
    }

    const interestList = (Array.isArray(parsedInterest) ? parsedInterest : [])
      .map((item) => {
        if (!item) return null;
        const id = item.id != null ? String(item.id) : null;
        if (!id) return null;
        return item.name ? { id, name: String(item.name) } : { id };
      })
      .filter(Boolean);

    if (!interestList.length) {
      throw new Error(
        "At least one interest is required for targeting. Select interests and retry.",
      );
    }

    const targetingBase = {
      geo_locations: parsedLocation,
      age_min: Number(ageRangeFrom) || 18,
      age_max: Number(effectiveAgeMax) || 65,
      genders: (Array.isArray(parsedGender) ? parsedGender : [])
        .map((g) => Number(g))
        .filter((g) => g === 1 || g === 2),
      // Meta requires interests under flexible_spec (top-level interests is invalid)
      flexible_spec: [{ interests: interestList }],
    };

    // `platforms` is Meta's user_os targeting (App Install ads), NOT the
    // Facebook/Instagram placement choice — that is publisher_platforms below.
    // Anything else here makes Meta reject the whole ad set, so only real OS
    // values are forwarded.
    const requestedOs = (Array.isArray(platforms) ? platforms : [platforms])
      .map((p) => String(p || "").trim().toLowerCase())
      .map((p) => (p === "ios" ? "iOS" : p === "android" ? "Android" : null))
      .filter(Boolean);
    if (requestedOs.length) {
      targetingBase.user_os = [...new Set(requestedOs)];
    }

    const targeting = {
      ...targetingBase,
      ...targetingAutomationOverrides,
    };

    if (typeof advantageAudienceEnabled === "boolean") {
      targeting.targeting_automation = {
        advantage_audience: advantageAudienceEnabled ? 1 : 0,
      };
      if (advantageAudienceEnabled) {
        targeting.age_max = Math.max(Number(targeting.age_max) || 0, 65);
      }
    }

    let combinedAdSetId = null;
    let adResponse = null;

    if (
      (isFacebookAdEnabled && facebookBudget > 0) ||
      (planData && planData?.facebookBudget > 0) ||
      (isInstaAdEnabled && instaBudget > 0) ||
      (planData && planData?.instaBudget > 0)
    ) {
      // Align with app UI; Meta absolute floor ~₹88.71
      const META_FLOOR_RUPEES = 88.71;
      const MIN_DAILY_BUDGET_PAISE = Math.ceil(META_FLOOR_RUPEES * 100);
      const totalGrossBudget =
        (Number(planDatas.facebookBudget || facebookBudge || 0) || 0) +
        (Number(planDatas.instaBudget || instaBudge || 0) || 0);
      const campaignDurationDays = Math.max(Math.ceil(diffDays) || 1, 1);
      const maxDailyFromTotal = Math.max(
        META_FLOOR_RUPEES,
        Math.floor(totalGrossBudget / campaignDurationDays),
      );

      // Prefer explicit daily budget from app (rupees); else total / days
      const clientDaily = Number(clientDailyBudgetRupees);
      let dailyBudgetRupees;
      if (Number.isFinite(clientDaily) && clientDaily > 0) {
        dailyBudgetRupees = clientDaily;
      } else {
        dailyBudgetRupees = totalGrossBudget / campaignDurationDays;
      }

      // Cap so daily × days cannot exceed wallet total charged
      if (dailyBudgetRupees > maxDailyFromTotal) {
        dailyBudgetRupees = maxDailyFromTotal;
      }

      if (!Number.isFinite(dailyBudgetRupees) || dailyBudgetRupees <= 0) {
        throw new Error(
          "Unable to calculate a valid daily budget. Please check the budget inputs.",
        );
      }

      if (dailyBudgetRupees < META_FLOOR_RUPEES) {
        throw new Error(
          `Daily budget must be at least ₹${META_FLOOR_RUPEES}. Increase your total budget or shorten the campaign duration.`,
        );
      }

      const dailyBudgetPaise = Math.max(
        Math.ceil(dailyBudgetRupees * 100),
        MIN_DAILY_BUDGET_PAISE,
      );
      const dailyBudgetRupeesStored = Math.round(dailyBudgetPaise / 100);
      // Store RUPEES in DB for app/admin display; Meta API still needs paise
      await internalCampaignModel.findByIdAndUpdate(
        { _id: internalCampaignData[0]._id },
        {
          $set: {
            dailyBudget: dailyBudgetRupeesStored,
          },
        },
      );
      targeting.publisher_platforms = [];
      targeting.facebook_positions = [];
      targeting.instagram_positions = [];
      if (isFacebookAdEnabled || (planData && planData?.facebookBudget > 0)) {
        targeting.publisher_platforms.push("facebook", "audience_network");
        targeting.facebook_positions = ["feed"];
      }
      if (isInstaAdEnabled || (planData && planData?.instaBudget > 0)) {
        if (!targeting.publisher_platforms.includes("instagram")) {
          targeting.publisher_platforms.push("instagram");
        }
        targeting.instagram_positions = ["stream"];
      }
      // Fallback: both platforms if flags somehow empty
      if (!targeting.publisher_platforms.length) {
        targeting.publisher_platforms = [
          "facebook",
          "audience_network",
          "instagram",
        ];
        targeting.facebook_positions = ["feed"];
        targeting.instagram_positions = ["stream"];
      }

      // Call ads still skip Meta adset/ad (out of scope). Lead Form + WhatsApp now create full Meta objects.
      const skipMetaAdSetAndAd = adKind === AD_KIND.CALL;

      if (!skipMetaAdSetAndAd) {
        const adSetConfig = resolveMetaAdSetConfig({
          adKind,
          pageId: businessData?.pageId,
          leadFormId: externalCampiagnData?.leadFormId,
          mobileNumber: effectiveMobileNumber,
          optimization_goal,
          billing_event,
          application_id: aaplicationId,
          destinationUrl,
        });

        if (
          adKind === AD_KIND.LEAD_FORM &&
          !externalCampiagnData?.leadFormId
        ) {
          throw new Error(
            "Lead Form could not be created on Meta. Fix page permissions and retry.",
          );
        }

        combinedAdSetId = await createFacebookAdSet(
          name,
          adSetConfig.optimization_goal,
          adSetConfig.billing_event,
          startDate,
          endDate,
          dailyBudgetPaise,
          targeting,
          campaignId,
          parsedDays,
          dayStartTime,
          dayEndTime,
          aaplicationId,
          destinationUrl,
          session,
          internalCampaignData[0]?._id,
          businessId,
          targeting.targeting_automation,
          adSetConfig.promoted_object,
          adSetConfig.destination_type,
        );

        if (!combinedAdSetId?.id) {
          throw new Error(
            combinedAdSetId?.error ||
              "Meta ad set creation failed for this campaign.",
          );
        }
      }

      if (combinedAdSetId?.id) {
        await adsDetailsService.createAdsDetails({
          businessId,
          title: name,
          internalCampiagnId: internalCampaignData[0]._id,
          dailyBudget: dailyBudgetRupeesStored,
          remainingBalance,
          metaAdsetId: combinedAdSetId.id,
          planId: planId || null,
          totalBudget,
        });

        const finalUpdatedInternalCampaign =
          await internalCampaignModel.findOneAndUpdate(
            { _id: internalCampaignData[0]._id },
            {
              $set: {
                facebookAdSetId: combinedAdSetId?.id,
                instaAdSetId: combinedAdSetId?.id,
              },
            },
            { new: true, session },
          );

        adResponse = await createAd(
          finalUpdatedInternalCampaign.title,
          finalUpdatedInternalCampaign.facebookAdSetId,
          finalUpdatedInternalCampaign.creativeId ||
            updatedInternalCampaign?.creativeId,
          getMetaAccessToken(),
          session,
          businessId,
          finalUpdatedInternalCampaign?._id,
        );

        if (!adResponse?.id) {
          throw new Error(
            adResponse?.error || "Meta ad creation failed for this campaign.",
          );
        }

        await internalCampaignModel.findOneAndUpdate(
          { _id: finalUpdatedInternalCampaign._id },
          {
            $set: {
              mainAdId: adResponse.id,
              metaAdId: adResponse.id,
              metaCreateError: null,
            },
          },
          { session },
        );
        await addDetailsModel.findOneAndUpdate(
          { metaAdsetId: finalUpdatedInternalCampaign.facebookAdSetId },
          { $set: { mainAdId: adResponse.id } },
          { session },
        );
      }
    }

    await session.commitTransaction();
    session.endSession();

    // Generate invoice

    console.info("Background ad creation completed successfully");
  } catch (error) {
    // Persist DELIVERY_ERROR inside the open transaction, then commit —
    // aborting would wipe the campaign row so admin never sees the failure.
    try {
      if (trackedInternalCampaignId && session.inTransaction()) {
        await internalCampaignModel.findByIdAndUpdate(
          trackedInternalCampaignId,
          {
            $set: {
              status: "DELIVERY_ERROR",
              metaCreateError: formatMetaAxiosError(error),
            },
          },
          { session },
        );
        await session.commitTransaction();
      } else if (session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (txnErr) {
      console.error("Failed to persist DELIVERY_ERROR in txn:", txnErr?.message);
      try {
        if (session.inTransaction()) await session.abortTransaction();
      } catch (_e) {
        /* ignore */
      }
    }
    try {
      session.endSession();
    } catch (_e) {
      /* ignore */
    }

    // Safety net if commit path failed (e.g. session already closed)
    try {
      if (trackedInternalCampaignId) {
        await internalCampaignModel.findByIdAndUpdate(
          trackedInternalCampaignId,
          {
            $set: {
              status: "DELIVERY_ERROR",
              metaCreateError: formatMetaAxiosError(error),
            },
          },
        );
      } else {
        // The run failed before the campaign row existed — a missing page
        // token, an unknown ad type, no usable targeting. The request already
        // answered 201, so without a row here the advertiser is told the ad was
        // created and then finds nothing at all. Leave a visible, explained row.
        await internalCampaignModel.create({
          businessId,
          title: name || "Untitled Campaign",
          addTypeId: addTypeId || null,
          status: "DELIVERY_ERROR",
          metaCreateError: formatMetaAxiosError(error),
          paymentStatus: transactionId ? "APPROVED" : "PENDING",
          totalBudget: Number(totalBudget) || 0,
          startDate: new Date().toUTCString(),
        });
      }
    } catch (statusErr) {
      console.error("Failed to persist DELIVERY_ERROR:", statusErr.message);
    }

    console.error(
      "Background ad creation failed:",
      formatMetaAxiosError(error),
    );

    await logMetaError({
      businessId,
      errorType: "GENERAL",
      error,
      internalCampaignId: trackedInternalCampaignId,
    });
  }
}

const extractAdSetRequest = (body = {}) => {
  const {
    businessId,
    name,
    optimization_goal = "REACH",
    billing_event = "IMPRESSIONS",
    remainingBalance,
    totalBudget,
    transactionId,
    externalCampiagnId,
    imageId,
    caption,
    callToActionId,
    audienceId,
    interest,
    location,
    audienceGender,
    ageRangeFrom,
    ageRangeTo,
    days,
    planId,
    facebookBudget,
    instaBudget,
    googleBudget,
    facebookBalance,
    instaBalance,
    googleBalance,
    dailySpendLimit,
    balanceAmount,
    startDate,
    endDate,
    dayStartTime,
    dayEndTime,
    isFacebookAdEnabled,
    isInstaAdEnabled,
    isGoogleAdEnabled,
    addTypeId,
    destinationUrl,
    aaplicationId,
    platforms,
    // serviceAmount,
    thambnail,
    imageVideo,
    type,
    headline,
    primaryText,
    adtype,
    mobileNumber,
    advantageAudienceEnabled,
    dailyBudget,
  } = body;

  return {
    businessId,
    name,
    optimization_goal,
    billing_event,
    remainingBalance,
    totalBudget,
    transactionId,
    externalCampiagnId,
    imageId,
    caption,
    callToActionId,
    audienceId,
    interest,
    location,
    audienceGender,
    ageRangeFrom,
    ageRangeTo,
    days,
    planId,
    facebookBudget,
    instaBudget,
    googleBudget,
    facebookBalance,
    instaBalance,
    googleBalance,
    dailySpendLimit,
    balanceAmount,
    startDate,
    endDate,
    dayStartTime,
    dayEndTime,
    isFacebookAdEnabled,
    isInstaAdEnabled,
    isGoogleAdEnabled,
    addTypeId,
    destinationUrl,
    aaplicationId,
    platforms,
    thambnail,
    imageVideo,
    type,
    headline,
    primaryText,
    adtype,
    mobileNumber,
    advantageAudienceEnabled,
    dailyBudget,
  };
};

const validateAdSetRequest = (payload) => {
  const {
    businessId,
    planId,
    isFacebookAdEnabled,
    isInstaAdEnabled,
    isGoogleAdEnabled,
    interest,
    location,
  } = payload;

  console.log("Validating ad set request payload:", {
    businessId,
    interest,
    location,
    name: payload.name,
  });

  if (!businessId) {
    throw new Error("businessId is required");
  }

  if (!planId) {
    const hasEnabledPlatform =
      Boolean(isFacebookAdEnabled) ||
      Boolean(isInstaAdEnabled) ||
      Boolean(isGoogleAdEnabled);

    if (!hasEnabledPlatform) {
      throw new Error(
        "One value required in isFacebookAdEnabled/isInstaAdEnabled/isGoogleAdEnabled",
      );
    }
  }

  if (!interest) {
    throw new Error("interest is required");
  }

  if (!location) {
    throw new Error("location is required");
  }
};

const prepareProcessAdCreationPayload = (payload) => {
  const { imageVideo, thambnail, ...rest } = payload;

  return {
    ...rest,
    fileLocation: imageVideo,
    thambnail,
  };
};

exports.createAdSetDefineBudgetAndDuration = async (req, res) => {
  try {
    const requestData = extractAdSetRequest(req.body);

    validateAdSetRequest(requestData);

    res
      .status(statusCodes.Created)
      .json(
        responseBuilder(apiResponseStatusCode[201], "Ads Create Successfully."),
      );

    processAdCreation(prepareProcessAdCreationPayload(requestData)).catch(
      (error) => {
        console.error(
          "Error in detached background processing:",
          error.message,
        );
      },
    );
  } catch (error) {
    console.error(
      "Error in createAdSetDefineBudgetAndDuration:",
      error.message,
    );
    return res
      .status(statusCodes["Bad Request"])
      .json(
        responseBuilder(
          apiResponseStatusCode[400],
          error.message || defaultResponseMessage.BAD_REQUEST,
        ),
      );
  }
};

exports.imageVideoUpload = async (req, res) => {
  try {
    console.log("Upload Request Headers:", req.headers);
    console.log("Upload Request Files:", req.files);

    if (!req.files || Object.keys(req.files).length === 0) {
      console.warn("No files received in request");
    }

    const imageVideo = req.files
      ? req.files?.files?.map((file) => file.location)
      : [];
    const thumbnail =
      req.files && req.files?.thumbnail
        ? req.files?.thumbnail[0].location
        : null;

    const normalizedImageVideo = normalizeMediaArray(imageVideo);
    const normalizedThumbnail = ensurePublicMediaUrl(thumbnail);

    console.log("Processed Upload Data:", {
      imageVideo: normalizedImageVideo,
      thumbnail: normalizedThumbnail,
    });

    return res.status(200).json({
      success: true,
      message: "File uploaded successfully",
      data: {
        imageVideo: normalizedImageVideo,
        thumbnail: normalizedThumbnail,
      },
    });
  } catch (error) {
    return res
      .status(statusCodes["Internal Server Error"])
      .json(
        responseBuilder(
          apiResponseStatusCode[500],
          error.message || defaultResponseMessage.INTERNAL_SERVER_ERROR,
        ),
      );
  }
};

exports.getAllAdsList = async (req, res) => {
  try {
    const { businessId, page = 1, addTypeId } = req.query;

    console.log("getAllAdsList Request received:", { businessId, page, addTypeId });

    const skip = (page - 1) * 20;
    let obj = {};

    if (businessId && businessId !== 'undefined' && mongoose.Types.ObjectId.isValid(businessId)) {
      obj.businessId = businessId;
    } else {
      console.warn("getAllAdsList: businessId is missing or invalid in query params", businessId);
    }
    
    // Define pageId for lead counting fallback
    let pageId = null;
    if (obj.businessId) {
      const business = await businessModel.findById(obj.businessId);
      pageId = business?.pageId;
    }
    if (addTypeId && addTypeId !== 'undefined') {
      obj.addTypeId = addTypeId;
    }

    const data =
      await internalCampaignServices.getAllIntenalCampiagnByBusinessId(
        obj,
        skip,
      );

    // Refresh every campaign against Meta in one parallel pass before we
    // serialize, so the list reports what Meta actually says right now —
    // in review, live, paused, finished or rejected — not what we last wrote.
    applyStatusToDocs(data, await syncCampaignStatuses(data));

    for (let i = 0; i < data.length; i++) {
      let totalReach = 0;
      let totalSpendBudget = 0;
      let totalImpression = 0;
      let totalClicks = 0;
      let totalBudget = 0;
      let totalFirstReplies = 0;

      const insightsUrl = (adSetId) =>
        `https://graph.facebook.com/v22.0/${adSetId}/insights?date_preset=maximum&access_token=${process.env.systemUserAccessToken}&fields=reach,impressions,clicks,spend,actions`;

      const fetchInsights = async (adSetId) => {
        try {
          const { data: response } = await axios.get(insightsUrl(adSetId));
          const insight = response?.data?.[0];
          if (insight) {
            const reach = parseInt(insight.reach || 0, 10);
            const spend = parseFloat(insight.spend || 0);
            const impressions = parseInt(insight.impressions || 0, 10);
            const clicks = parseInt(insight.clicks || 0, 10);

            totalReach += Number.isFinite(reach) ? reach : 0;
            totalSpendBudget += Number.isFinite(spend)
              ? Math.ceil(spend * 1.18)
              : 0; // Adding 18% GST
            totalImpression += Number.isFinite(impressions) ? impressions : 0;
            totalClicks += Number.isFinite(clicks) ? clicks : 0;

            const actions = insight.actions || [];
            const firstReplyAction = actions.find(
              (action) =>
                action.action_type ===
                  "onsite_conversion.messaging_first_reply" ||
                action.action_type === "click_to_call_call_confirm",
            );
            const conversationStartedAction = actions.find(
              (action) =>
                action.action_type ===
                "onsite_conversion.messaging_conversation_started_7d",
            );
            const leadGenerationAction = actions.find(
              (action) =>
                action.action_type === "leadgen" ||
                action.action_type === "lead" ||
                action.action_type === "onsite_conversion.lead" ||
                action.action_type === "onsite_conversion.lead_grouped" ||
                action.action_type === "lead_grouped" ||
                action.action_type === "onsite_web_lead",
            );
            const firstReplies = parseInt(firstReplyAction?.value || 0, 10);
            const conversationStarted = parseInt(
              conversationStartedAction?.value || 0,
              10,
            );
            const leadsFromMeta = parseInt(leadGenerationAction?.value || 0, 10);

            let currentAdLeads = 0;
            if (leadsFromMeta > 0) {
              currentAdLeads = leadsFromMeta;
            } else {
              currentAdLeads = Math.max(firstReplies, conversationStarted);
            }
            totalFirstReplies += currentAdLeads;
          }
        } catch (error) {
          console.warn(
            `Failed to fetch insights for adSetId ${adSetId}:`,
            error.message,
          );
        }
      };

      if (data[i].mainAdId) {
        await fetchInsights(data[i].mainAdId);

      }

      totalBudget = data[i]?.totalBudget || 0;
      const addAmount = data[i]?.AddAmountInsights || {};

      // Count leads per-campaign only. Matching on pageId here would count
      // ALL leads of the page across every campaign of that page, making each
      // campaign show the same inflated total. Leads always carry
      // internalCampiagnId + adId (set by the webhook), so those are accurate.
      const leadMatch = [{ internalCampiagnId: data[i]._id }];
      if (data[i].mainAdId) leadMatch.push({ adId: data[i].mainAdId });
      let leadCount = await leadModel.countDocuments({ $or: leadMatch });
      console.log(`Campaign ${data[i]._id} (mainAdId: ${data[i].mainAdId}, pageId: ${pageId}) -> Found ${leadCount} leads`);

      // Update for old app compatibility: ensure totalFirstReplies reflects leadCount if it's a lead ad
      const finalFirstReplies = Math.max(totalFirstReplies || 0, leadCount || 0) + (addAmount?.totalFirstReplies || 0);
      const finalReach = ((totalReach || 0) + (addAmount?.totalReach || 0)) || data[i]?.totalReach || 0;
      const finalImpression = ((totalImpression || 0) + (addAmount?.totalImpression || 0)) || data[i]?.totalImpression || 0;
      const finalClicks = ((totalClicks || 0) + (addAmount?.totalClicks || 0)) || data[i]?.totalClicks || 0;
      // Never wipe DB spend when Meta returned no insights row
      const hasLiveSpend = Number.isFinite(totalSpendBudget) && totalSpendBudget > 0;
      const dbSpend = Number(data[i]?.spendAmount || data[i]?.totalSpendBudget) || 0;
      const finalSpend =
        (hasLiveSpend ? totalSpendBudget : dbSpend) +
        (addAmount?.totalSpendBudget || 0);
      const finalLeads = Math.max(leadCount, totalFirstReplies || 0) + (addAmount?.totalLeads || 0);

      // Persist live Meta metrics only when we have something meaningful
      if (hasLiveSpend || finalReach || finalImpression || finalClicks) {
        await internalCampaignModel.findByIdAndUpdate(data[i]._id, {
          $set: {
            ...(hasLiveSpend
              ? { spendAmount: finalSpend, totalSpendBudget: finalSpend }
              : {}),
            totalReach: finalReach,
            totalImpression: finalImpression,
            totalClicks: finalClicks,
            totalFirstReplies: finalFirstReplies,
            totalLeads: finalLeads,
            updatedAt: new Date(),
          },
        });
      }

      Object.assign(data[i]._doc || data[i], {
        totalReach: finalReach,
        totalSpendBudget: finalSpend,
        spendAmount: finalSpend,
        totalImpression: finalImpression,
        totalBudget: (addAmount?.totalBudget || 0) || totalBudget,
        dailyBudget: data[i]?.dailyBudget || 0,
        metaCreateError: data[i]?.metaCreateError || null,
        // What Meta itself says, so the app can show the real reason a
        // campaign is in review, paused or rejected rather than a bare badge.
        metaEffectiveStatus: data[i]?.metaEffectiveStatus || null,
        metaStatusReason: data[i]?.metaStatusReason || null,
        metaStatusSyncedAt: data[i]?.metaStatusSyncedAt || null,
        totalClicks: finalClicks,
        totalLeads: finalLeads,
        totalFirstReplies: finalFirstReplies,
      });

      const normalizedImageList = normalizeMediaArray(data[i]._doc.image || []);
      const normalizedThumbnail = ensurePublicMediaUrl(data[i]._doc.thambnail);
      const campaignVideoUrl =
        normalizedImageList.find((url) => isLikelyVideoUrl(url)) || null;
      const campaignImageUrl =
        normalizedImageList.find((url) => !isLikelyVideoUrl(url)) || null;

      Object.assign(data[i]._doc, {
        image: normalizedImageList,
        thambnail: normalizedThumbnail,
        videoUrl: campaignVideoUrl,
        mediaUrl: campaignVideoUrl || campaignImageUrl || normalizedThumbnail || null,
      });
    }

    const totalCount = await internalCampaignModel.countDocuments({
      businessId,
    });
    const pageCount = Math.ceil(totalCount / 20);

    return res.status(statusCodes.OK).json({
      message: defaultResponseMessage?.FETCHED,
      data,
      page: pageCount,
      curentPage: Number(page),
    });
  } catch (error) {
    console.error("Error in getAllAdsList:", error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.getInternalCampiagnById = async (req, res) => {
  try {
    const { internalCampaignId } = req.query;
    const token = req.headers["authorization"];
    let requestedPermissions = [
      // { "Roles&Permission": ["read", "write"] },
      // { "Leads": ["read", "write"] },
      { Ads: ["read"] },
    ];
    //  let checkPermission =   await checkPermissions(requestedPermissions,token)
    //   if(!checkPermission){
    //     return res
    //     .status(400)
    //     .send({ success: false, message: "Access denied"});
    //   }
    let data = await internalCampaignModel
      .findById(internalCampaignId)
      .populate("addTypeId", "title");
    let facebookLeadCount = 0;
    let instaLeadCount = 0;
    if (data.isFacebookAdEnabled) {
      let addDetails = await addDetailsModel.findOne({
        metaAdsetId: data?.facebookAdSetId,
      });
      facebookLeadCount = await leadModel.countDocuments({
        adId: addDetails?.mainAdId,
      });
      data._doc.facebookLeadCount = facebookLeadCount;
    }
    if (data.isInstaAdEnabled) {
      let addDetails = await addDetailsModel.findOne({
        metaAdsetId: data?.instaAdSetId,
      });
      instaLeadCount = await leadModel.countDocuments({
        adId: addDetails?.mainAdId,
      });
      data._doc.instaLeadCount = instaLeadCount;
    }
    return res.status(200).send({
      success: true,
      message: "internalCampiagn data fetched",
      data: data,
    });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.getAdvertismentReport = async (req, res) => {
  try {
    let { metaAdsetId } = req.query;
    let finalData = {};
    const token = req.headers["authorization"];
    let requestedPermissions = [
      // { "Roles&Permission": ["read", "write"] },
      // { "Leads": ["read", "write"] },
      { Ads: ["read"] },
    ];
    //  let checkPermission =   await checkPermissions(requestedPermissions,token)
    //   if(!checkPermission){
    //     return res
    //     .status(400)
    //     .send({ success: false, message: "Access denied"});
    //   }
    let data = await addDetailsModel
      .findOne({ metaAdsetId: metaAdsetId })
      .populate("businessId", "metaAccessToken pageId")
      .populate("internalCampiagnId", "image startDate endDate videoId creativeId");
    if (!data) {
      return res
        .status(400)
        .send({ success: false, message: "please give valid metaAdsetId" });
    }
    const accessToken = process.env.systemUserAccessToken;
    for (let i = 0; i < 8; i++) {
      try {
        if (i == 0) {
          const apiUrl = `https://graph.facebook.com/v22.0/${metaAdsetId}/insights?date_preset=maximum&access_token=${accessToken}&fields=reach, impressions, clicks, spend`;
          let response = await axios.get(apiUrl);
          finalData.keyPerformanceIndicators = response.data;
        }
        if (i == 1) {
          const apiUrl = `https://graph.facebook.com/v22.0/${metaAdsetId}/insights?date_preset=maximum&access_token=${accessToken}&fields=impressions&breakdowns=device_platform`;
          let response = await axios.get(apiUrl);
          finalData.deviceReach = response.data;
        }
        if (i == 2) {
          const apiUrl = `https://graph.facebook.com/v22.0/${metaAdsetId}/insights?date_preset=maximum&access_token=${accessToken}&fields=impressions&breakdowns=age`;
          let response = await axios.get(apiUrl);
          finalData.ageWiseChart = response.data;
        }
        if (i == 3) {
          const apiUrl = `https://graph.facebook.com/v22.0/${metaAdsetId}/insights?date_preset=maximum&access_token=${accessToken}&fields=impressions&breakdowns=gender`;
          let response = await axios.get(apiUrl);
          finalData.gender = response.data;
        }
        if (i == 4) {
          const apiUrl = `https://graph.facebook.com/v22.0/${metaAdsetId}/insights?date_preset=maximum&access_token=${accessToken}&fields=impressions&breakdowns=publisher_platform, platform_position`;
          let response = await axios.get(apiUrl);
          finalData.placements = response.data;
        }
        if (i == 5) {
          const apiUrl = `https://graph.facebook.com/v22.0/${metaAdsetId}/insights?date_preset=maximum&access_token=${accessToken}&fields=actions`;
          let response = await axios.get(apiUrl);
          finalData.engagements = response.data;
        }
        if (i == 6) {
          const apiUrl = `https://graph.facebook.com/v22.0/${metaAdsetId}/insights?date_preset=maximum&access_token=${accessToken}&fields=impressions, clicks, ctr&breakdowns=region`;
          let response = await axios.get(apiUrl);
          finalData.stateWisePerformance = response.data;
        }
        if (i == 7) {
          const apiUrl = `https://graph.facebook.com/v22.0/${metaAdsetId}/insights?date_preset=maximum&access_token=${accessToken}&fields=impressions, clicks, ctr&breakdowns=dma`;
          let response = await axios.get(apiUrl);
          finalData.cityWisePerformance = response.data;
        }
      } catch (err) {
        console.warn(`Error fetching Meta report facet ${i}:`, err.message);
      }
    }
    // console.log('fjkdfskj')
    const leadCount = await leadModel.countDocuments({
      $or: [
        { internalCampiagnId: data?.internalCampiagnId?._id },
        { adId: data?.mainAdId },
        ...(data?.businessId?.pageId ? [{ pageId: data.businessId.pageId }] : [])
      ]
    });
    finalData.totalLeadsFromDB = leadCount;

    // Media Recovery Logic
    if (data.internalCampiagnId && (!data.internalCampiagnId.image?.length && !data.internalCampiagnId.videoId)) {
      const pageAccessToken = data.businessId?.metaAccessToken || process.env.systemUserAccessToken;
      try {
        const adAccountId = data.businessId?.metaAdAccountId || process.env.adAccountId;
        const creative = await discoverMetaCreative(data.mainAdId || metaAdsetId, adAccountId, pageAccessToken);
        if (creative) {
          if (creative.video_id) {
            // Re-host Meta's temporary signed URL to permanent storage — Meta's own URL expires within hours
            const hostedThumbnail =
              (await uploadUrlToBucket(creative.thumbnail_url, "LEADKART/IMAGE/META/")) || creative.thumbnail_url;
            finalData.recoveredVideoId = creative.video_id;
            finalData.recoveredThumbnail = hostedThumbnail;
            // Persist to DB for future
            await internalCampaignModel.findByIdAndUpdate(data.internalCampiagnId._id, {
              $set: { videoId: creative.video_id, thambnail: hostedThumbnail }
            });
          } else if (creative.image_url) {
            const hostedImage =
              (await uploadUrlToBucket(creative.image_url, "LEADKART/IMAGE/META/")) || creative.image_url;
            finalData.recoveredImageUrl = hostedImage;
             // Persist to DB for future
             await internalCampaignModel.findByIdAndUpdate(data.internalCampiagnId._id, {
              $set: { image: [hostedImage] }
            });
          }
        }
      } catch (e) {
        console.warn("Media recovery from Meta failed:", e.message);
      }
    }

    return res.status(200).send({
      success: true,
      message: "all report fetched successfully",
      imageUrl: data?.internalCampiagnId?.image,
      startDate: data?.internalCampiagnId?.startDate,
      endDate: data?.internalCampiagnId?.endDate,
      fullReport: finalData,
    });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.scheduleDeliveryOfAdd = async (req, res) => {
  try {
    const { internalCampaignId, status } = req.query;
    let internalCampaignData = await internalCampaignModel
      .findById(internalCampaignId)
      .populate("businessId", "metaAccessToken");
    const apiUrl = `https://graph.facebook.com/v22.0/${process.env.adAccountId}/ads`;
    if (internalCampaignData.facebookAdSetId) {
      let response = await axios.post(apiUrl, {
        name: internalCampaignData.title,
        adset_id: internalCampaignData.facebookAdSetId,
        creative: `{
        'creative_id': ${internalCampaignData.creativeId}
      }`,
        status: status,
        access_token: process.env.systemUserAccessToken,
      });
      await addDetailsModel.findOneAndUpdate(
        { metaAdsetId: internalCampaignData.facebookAdSetId },
        {
          $set: {
            mainAdId: response?.data?.id,
          },
        },
      );
    }
    if (internalCampaignData.instaAdSetId) {
      const response = await axios.post(apiUrl, {
        name: internalCampaignData.title,
        adset_id: internalCampaignData.instaAdSetId,
        creative: `{
        'creative_id': ${internalCampaignData.creativeId}
      }`,
        status: status,
        access_token: process.env.systemUserAccessToken,
      });
      await addDetailsModel.findOneAndUpdate(
        { metaAdsetId: internalCampaignData.instaAdSetId },
        {
          $set: {
            mainAdId: response?.data?.id,
          },
        },
      );
    }
    let updateInternal = await internalCampaignModel.findByIdAndUpdate(
      { _id: internalCampaignId },
      {
        $set: {
          status: status,
        },
      },
      {
        new: true,
      },
    );
    return res.status(200).send({
      success: false,
      message: "your ad status change successfully",
      data: updateInternal,
    });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.targetingLocation = async (req, res) => {
  try {
    const { businessId, search } = req.query;
    if (!businessId) {
      return res
        .status(400)
        .send({ success: false, message: "businessId is required" });
    }
    if (!search || String(search).trim().length < 2) {
      return res.status(200).send({
        success: true,
        message: "Target Search Area Data",
        data: [],
      });
    }
    const q = encodeURIComponent(String(search).trim());
    const apiUrl = `https://graph.facebook.com/v22.0/search?type=adgeolocation&q=${q}&location_types=["city","region","neighborhood","geo_market","electoral_district","zip"]&access_token=${process.env.systemUserAccessToken}&country_code=IN`;
    const response = await axios.get(apiUrl);
    return res.status(200).send({
      success: true,
      message: "Target Search Area Data",
      data: response?.data?.data || [],
    });
  } catch (error) {
    console.error(
      "targetingLocation error:",
      error.response?.data || error.message,
    );
    return res.status(500).send({
      success: false,
      message: error.response?.data?.error?.message || error.message,
      data: [],
    });
  }
};

exports.targetingInterest = async (req, res) => {
  try {
    const { businessId, search } = req.query;
    if (!businessId) {
      return res
        .status(400)
        .send({ success: false, message: "businessId is required" });
    }
    if (!search || String(search).trim().length < 1) {
      return res.status(200).send({
        success: true,
        message: "Target Search Interest Data",
        data: [],
      });
    }
    const q = encodeURIComponent(String(search).trim());
    const apiUrl = `https://graph.facebook.com/v22.0/search?type=adinterest&q=${q}&access_token=${process.env.systemUserAccessToken}`;
    let response = await axios.get(apiUrl);
    return res.status(200).send({
      success: true,
      message: "Target Search Interest Data",
      data: response?.data?.data || [],
    });
  } catch (error) {
    console.error("targetingInterest error:", error.response?.data || error.message);
    return res.status(500).send({
      success: false,
      message: error.response?.data?.error?.message || error.message,
      data: [],
    });
  }
};

exports.forDemoAd = async (req, res) => {
  try {
    let data = await internalCampaignModel.findById("6694c0012d938ab030433868");
    return res
      .status(200)
      .send({ success: true, message: "demo add fetched", data: data });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.updateMetaAdsId = async (req, res) => {
  try {
    const { metaAdsetId, mainAdId } = req.body;

    if (!metaAdsetId || !mainAdId) {
      return res.status(400).send({
        success: false,
        message: "metaAdsetId and mainAdId are required",
      });
    }

    const updatedData = await addDetailsModel.findOneAndUpdate(
      { metaAdsetId: metaAdsetId },
      { $set: { mainAdId: mainAdId } },
      { new: true },
    );

    if (!updatedData) {
      return res.status(404).send({
        success: false,
        message: "No record found with the provided metaAdsetId",
      });
    }

    return res.status(200).send({
      success: true,
      message: "Meta ad ID updated successfully",
      data: updatedData,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: error.message,
    });
  }
};

/**
 * True when a parsed geo spec carries something Meta can actually target —
 * either pin-and-radius custom_locations, or a country/region selection (Pan India).
 */
function hasUsableGeoTarget(geo) {
  if (!geo || typeof geo !== "object") return false;
  return Boolean(
    (Array.isArray(geo.custom_locations) && geo.custom_locations.length) ||
      (Array.isArray(geo.countries) && geo.countries.length) ||
      (Array.isArray(geo.regions) && geo.regions.length),
  );
}

function convertLocationToMetaGeo(inputString) {
  try {
    let b =
      typeof inputString === "string"
        ? inputString.replace(/\\/g, "")
        : JSON.stringify(inputString);
    const locations = typeof b === "string" ? JSON.parse(b) : b;
    const coords = Array.isArray(locations?.coordinates)
      ? locations.coordinates
      : [];

    const custom_locations = coords
      .map((coord) => {
        const newObj = {};
        if (coord.address) newObj.address_string = String(coord.address);

        const lat = parseFloat(coord.latitude);
        if (!isNaN(lat)) newObj.latitude = lat;

        const lng = parseFloat(coord.longitude);
        if (!isNaN(lng)) newObj.longitude = lng;

        // Meta wants kilometres, 1–80. The app sends km (its picker is capped
        // at 50); legacy callers sent metres, so a magnitude guess still covers
        // them — but an explicit unit always wins over the guess.
        let radiusKm = parseFloat(coord.radius);
        if (!isNaN(radiusKm)) {
          const unit = String(
            coord.distance_unit || coord.radiusUnit || "",
          ).toLowerCase();
          const isMetres = unit
            ? unit.startsWith("m") && !unit.startsWith("mi")
            : radiusKm > 200;
          if (isMetres) radiusKm = radiusKm / 1000;
          newObj.radius = Math.max(1, Math.min(80, radiusKm));
        } else {
          newObj.radius = 8;
        }

        newObj.distance_unit = "kilometer";
        return newObj;
      })
      .filter(
        (c) =>
          Number.isFinite(c.latitude) && Number.isFinite(c.longitude),
      );

    // Country / region targeting (e.g. Pan India) is a first-class Meta geo spec and
    // carries no coordinates, so pass it straight through instead of dropping it.
    const passthrough = {};
    if (Array.isArray(locations?.countries) && locations.countries.length) {
      passthrough.countries = locations.countries.map((c) => String(c).toUpperCase());
    }
    if (Array.isArray(locations?.regions) && locations.regions.length) {
      passthrough.regions = locations.regions;
    }

    if (!custom_locations.length && Object.keys(passthrough).length) {
      return passthrough;
    }

    return {
      custom_locations,
      ...passthrough,
    };
  } catch (err) {
    console.error("Failed to fix, parse, and convert location string:", err);
    return null;
  }
}

function fixParseAndConvertLocationString(inputString) {
  return convertLocationToMetaGeo(inputString);
}

// Replace with your actual Facebook details
const accessToken = process.env.systemUserAccessToken;
const adAccountId = process.env.adAccountId;

// Location-based CPM lookup table
const cpmByLocation = {
  IN: 3.5,
  US: 15.0,
  GB: 12.0,
  default: 5.33,
};

// Location-based performance rates
const ratesByLocation = {
  IN: { ctr: 0.04, conversionRate: 0.015, engagementRate: 0.06 },
  US: { ctr: 0.008, conversionRate: 0.01, engagementRate: 0.04 },
  GB: { ctr: 0.009, conversionRate: 0.012, engagementRate: 0.045 },
  default: { ctr: 0.01, conversionRate: 0.01, engagementRate: 0.05 },
};

// Ad type-specific logic with reach adjustment factors
const adTypeConfigs = {
  lead: {
    ctrKey: "clicks",
    conversionRate: true,
    key: "leadsCount",
    reachAdjustment: 0.45, // Lower reach due to targeted audience
  },
  engage: {
    engagementRate: true,
    key: "engagementCount",
    reachAdjustment: 1.0, // Standard reach
  },
  traffic: {
    ctrKey: "clicks",
    key: "clicksCount",
    reachAdjustment: 0.9, // Slightly lower reach due to click focus
  },
  install: {
    ctrKey: "clicks",
    conversionRate: true,
    key: "installsCount",
    reachAdjustment: 0.7, // Lower reach due to specific app install targeting
  },
  sales: {
    ctrKey: "clicks",
    conversionRate: true,
    key: "salesCount",
    reachAdjustment: 0.75, // Lower reach due to conversion focus
  },
  awareness: {
    impressionRate: 1,
    key: "impressionsCount",
    reachAdjustment: 1.2, // Higher reach for broad awareness campaigns
  },
};

exports.getAdEstimate = async (req, res) => {
  const {
    dailyBudget = 800,
    country = "IN",
    adType = "lead", // default ad type
    businessId,
  } = req.query;

  if (!dailyBudget || isNaN(dailyBudget) || dailyBudget <= 0) {
    return res.status(400).json({
      error: "Parameter 'dailyBudget' must be a positive number.",
    });
  }

  if (!country || typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) {
    return res.status(400).json({
      error:
        "Parameter 'country' must be a valid two-letter country code (e.g., 'IN', 'US').",
    });
  }
  if (!adTypeConfigs[adType]) {
    return res.status(400).json({
      error: `Unsupported adType '${adType}'. Use one of: ${Object.keys(
        adTypeConfigs,
      ).join(", ")}`,
    });
  }

  let activeAdAccountId = adAccountId || "act_1309111200667696";

  if (businessId && mongoose.isValidObjectId(businessId)) {
    try {
      const business = await businessModel.findById(businessId);
      if (business && business.metaAdAccountId) {
        activeAdAccountId = business.metaAdAccountId;
      }
    } catch (dbErr) {
      console.error("Failed to fetch business metaAdAccountId:", dbErr);
    }
  }

  const cpm = cpmByLocation[country] || cpmByLocation.default;
  const rates = ratesByLocation[country] || ratesByLocation.default;
  const { ctr, conversionRate, engagementRate } = rates;
  const config = adTypeConfigs[adType];
  const reachAdjustment = config.reachAdjustment || 1.0; // Default to no adjustment

  try {
    let usersRange = [0, 0];
    
    try {
      const response = await axios.get(
        `https://graph.facebook.com/v22.0/${activeAdAccountId}/reachestimate`,
        {
          params: {
            access_token: accessToken,
            targeting_spec: JSON.stringify({
              geo_locations: { countries: [country.toUpperCase()] },
              publisher_platforms: ["facebook"],
            }),
          },
        },
      );

      const reachData = response.data?.data;
      if (reachData && reachData.users) {
        usersRange = reachData.users.split("-").map(Number);
      }
    } catch (apiError) {
      console.warn("Meta API failed for reach estimate, using fallback calculation:", apiError.response?.data?.error?.message || apiError.message);
    }


    // Apply ad type-specific reach adjustment to API response or fallback
    const estimatedReachLower =
      (usersRange[0] || calculateReach(dailyBudget * 0.5, cpm, adType)) *
      reachAdjustment;
    const estimatedReachUpper =
      (usersRange[1] || calculateReach(dailyBudget * 0.9, cpm, adType)) *
      reachAdjustment;

    const scalingFactor = Math.log10(dailyBudget + 10) / Math.log10(1010);
    const scaledReachLower = estimatedReachLower * scalingFactor;
    const scaledReachUpper = estimatedReachUpper * scalingFactor;

    const result = {
      reachEstimate: {
        lowerBound: Math.round(scaledReachLower),
        upperBound: Math.round(scaledReachUpper),
        estimatedReach: `Between ${Math.round(
          scaledReachLower,
        )} and ${Math.round(scaledReachUpper)} people`,
      },
      meta: {
        cpmUsed: cpm,
        country: country.toUpperCase(),
        scalingFactorApplied: scalingFactor.toFixed(2),
        adType,
        reachAdjustmentApplied: reachAdjustment.toFixed(2),
      },
    };

    if (config.ctrKey) {
      const clicksLower = scaledReachLower * ctr;
      const clicksUpper = scaledReachUpper * ctr;

      if (config.key === "clicksCount") {
        result[config.key] = {
          lowerBound: Math.round(clicksLower),
          upperBound: Math.round(clicksUpper),
        };
      }

      if (config.conversionRate) {
        const conversionsLower = clicksLower * conversionRate;
        const conversionsUpper = clicksUpper * conversionRate;
        result[config.key] = {
          lowerBound: Math.round(conversionsLower),
          upperBound: Math.round(conversionsUpper),
        };
      }
    }

    if (config.engagementRate) {
      const engagementLower = scaledReachLower * engagementRate;
      const engagementUpper = scaledReachUpper * engagementRate;
      result[config.key] = {
        lowerBound: Math.round(engagementLower),
        upperBound: Math.round(engagementUpper),
      };
    }

    if (config.impressionRate) {
      const impressionsLower = scaledReachLower * config.impressionRate;
      const impressionsUpper = scaledReachUpper * config.impressionRate;
      result[config.key] = {
        lowerBound: Math.round(impressionsLower),
        upperBound: Math.round(impressionsUpper),
      };
    }

    return res.json({
      success: true,
      message: "Fetched Successfully.",
      data: result,
    });
  } catch (error) {
    const errorMessage =
      error.response?.data?.error?.message ||
      "Failed to fetch ad estimates from Meta API.";
    return res.status(500).json({
      error: errorMessage,
      fbTraceId: error.response?.data?.error?.fbtrace_id || "N/A",
    });
  }
};

// Basic reach fallback calculator with ad type adjustment
function calculateReach(budget, cpm, adType) {
  const baseReach = Math.max(0, (budget / cpm) * 1000);
  const reachAdjustment = adTypeConfigs[adType]?.reachAdjustment || 1.0;
  return baseReach * reachAdjustment;
}
exports.getAllAdPreviews = async (req, res) => {
  try {
    const adId = "3588741597925219"; // Your Ad ID
    const accessToken =
      getMetaAccessToken();

    const adFormats = [
      "MOBILE_FEED_STANDARD",
      "INSTAGRAM_STANDARD",
      "INSTAGRAM_REELS",
      "AUDIENCE_NETWORK_INSTREAM_VIDEO",
      "MARKETPLACE_MOBILE",
      "REELS_MOBILE",
      "MESSENGER_INBOX_MEDIA_MOBILE",
      // Add more formats if needed
    ];

    const targetingSpec = {
      geo_locations: { countries: ["IN"] },
      publisher_platforms: ["facebook", "instagram"],
    };

    // Create an array of API request promises
    const requests = adFormats.map((ad_format) => {
      const url = `https://graph.facebook.com/v19.0/${adId}/previews`;
      return axios
        .get(url, {
          params: {
            access_token: accessToken,
            ad_format,
            targeting_spec: JSON.stringify(targetingSpec),
          },
        })
        .then((response) => ({
          ad_format,
          preview: response.data,
        }))
        .catch((error) => ({
          ad_format,
          error: error.response?.data || error.message,
        }));
    });

    const previews = await Promise.all(requests);

    res.status(200).json({
      success: true,
      previews, // array of previews for different formats
    });
  } catch (error) {
    console.error("Error fetching ad previews:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch ad previews",
      error: error.message,
    });
  }
};

// === CONFIG ===
const sharp = require("sharp");
const NodeCache = require("node-cache");
let ffmpeg;
let ffmpegAvailable = false;
try {
  const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg"); // For the ffmpeg path
  const ffprobeInstaller = require("@ffprobe-installer/ffprobe"); // For the ffprobe path
  ffmpeg = require("fluent-ffmpeg"); // The main library for ffmpeg operations
  // Set paths for ffmpeg and ffprobe so fluent-ffmpeg can find them
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  ffmpeg.setFfprobePath(ffprobeInstaller.path);
  ffmpegAvailable = true;
  console.log("✅ ffmpeg loaded successfully");
} catch (err) {
  console.warn("⚠️ ffmpeg not available:", err.message);
  console.warn("Video frame extraction will be disabled.");
}
const {
  sendNotificationToMultipleTokens,
} = require("./notificationController");

const cache = new NodeCache({ stdTTL: 3600 });

const dirname = path.dirname(__filename);
const tempDir = path.join(dirname, "temp");

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

// === UTILS ===

async function extractMultipleVideoFramesFromStream(
  videoBuffer,
  baseTimestampForFilename,
) {
  if (!ffmpegAvailable) {
    console.warn("ffmpeg not available, skipping video frame extraction.");
    return [];
  }
  const videoPath = path.join(
    tempDir,
    `temp_video_${baseTimestampForFilename}.mp4`,
  );
  fs.writeFileSync(videoPath, videoBuffer);

  let duration = 0;
  try {
    duration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.error(`ffprobe error for ${videoPath}:`, err.message);
          return reject(
            new Error(`Failed to get video duration: ${err.message}`),
          );
        }
        if (
          !metadata ||
          !metadata.format ||
          typeof metadata.format.duration !== "number"
        ) {
          console.error(
            `ffprobe did not return valid duration for ${videoPath}. Metadata:`,
            JSON.stringify(metadata),
          );
          if (
            metadata &&
            metadata.streams &&
            metadata.streams.length > 0 &&
            metadata.streams[0].duration
          ) {
            resolve(parseFloat(metadata.streams[0].duration));
          } else {
            return reject(
              new Error("Invalid or missing duration metadata from ffprobe."),
            );
          }
        } else {
          resolve(metadata.format.duration);
        }
      });
    });
  } catch (error) {
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    console.error(
      `Error getting video duration for ${baseTimestampForFilename}: ${error.message}`,
    );
    return []; // Return empty if duration cannot be obtained
  }

  const ffmpegTimestampsFormatted = [];
  if (duration > 0) {
    const targetSeconds = [];
    const MAX_FRAMES = 4;

    if (duration >= 1) targetSeconds.push(1);
    if (duration >= 5) targetSeconds.push(5);
    if (duration >= 10) targetSeconds.push(Math.min(10, duration - 0.1));
    if (duration >= 15) targetSeconds.push(Math.min(14.5, duration - 0.1));

    const currentFrameCount = new Set(
      targetSeconds.filter((t) => t < duration && t >= 0),
    ).size;
    if (currentFrameCount < MAX_FRAMES) {
      if (duration > 20 && targetSeconds.length < MAX_FRAMES)
        targetSeconds.push(
          Math.floor(Math.min(duration * 0.35, duration - 0.1)),
        );
      if (duration > 30 && targetSeconds.length < MAX_FRAMES)
        targetSeconds.push(
          Math.floor(Math.min(duration * 0.65, duration - 0.1)),
        );
      if (duration > 40 && targetSeconds.length < MAX_FRAMES)
        targetSeconds.push(
          Math.floor(Math.min(duration * 0.85, duration - 0.1)),
        );
    }

    const uniqueSortedSeconds = [...new Set(targetSeconds)]
      .filter((s) => s < duration && s >= 0)
      .sort((a, b) => a - b)
      .slice(0, MAX_FRAMES);

    if (uniqueSortedSeconds.length === 0 && duration > 0.2) {
      uniqueSortedSeconds.push(
        Math.max(0, Math.min(duration * 0.1, duration - 0.1)),
      );
    }

    uniqueSortedSeconds.forEach((s_val) => {
      const hours = Math.floor(s_val / 3600);
      const minutes = Math.floor((s_val % 3600) / 60);
      const secondsValue = s_val % 60;
      ffmpegTimestampsFormatted.push(
        `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
          2,
          "0",
        )}:${secondsValue.toFixed(3).padStart(6, "0")}`,
      );
    });
  }

  if (ffmpegTimestampsFormatted.length === 0) {
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (duration > 0) {
      console.warn(
        `No valid timestamps generated for video ${baseTimestampForFilename} (duration: ${duration}s). Attempting frame at 0s.`,
      );
      ffmpegTimestampsFormatted.push("00:00:00.000");
    } else {
      console.warn(
        `Video ${baseTimestampForFilename} has duration ${duration}s or less. Skipping frame extraction.`,
      );
      return [];
    }
  }

  const outputPattern = `frame_${baseTimestampForFilename}_%i.jpg`;
  const frameBuffers = [];
  const createdFrameFiles = [];

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ffmpegTimestampsFormatted,
          filename: outputPattern,
          folder: tempDir,
          size: "800x?",
        })
        .on("filenames", function (filenames) {
          filenames.forEach((filename) =>
            createdFrameFiles.push(path.join(tempDir, filename)),
          );
        })
        .on("end", () => {
          for (const filePath of createdFrameFiles) {
            if (fs.existsSync(filePath)) {
              frameBuffers.push(fs.readFileSync(filePath));
            } else {
              console.warn(
                `Generated frame file ${filePath} (reported by ffmpeg) not found on disk.`,
              );
            }
          }
          resolve();
        })
        .on("error", (err) => {
          console.error(
            `ffmpeg error during screenshot extraction for ${videoPath} (timestamps: ${ffmpegTimestampsFormatted.join(
              ", ",
            )}):`,
            err.message,
          );
          if (err.stderr) console.error("ffmpeg stderr:", err.stderr);
          reject(err);
        });
    });
  } catch (error) {
    console.error(
      `Error processing screenshots for ${videoPath}: ${error.message}`,
    );
  } finally {
    createdFrameFiles.forEach((filePath) => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
  }

  return frameBuffers;
}

async function fetchFacebookAdInterests(searchKeywords) {
  if (!process.env.systemUserAccessToken) {
    console.warn(
      "Facebook systemUserAccessToken is not set in environment variables. Skipping Facebook interest fetching and returning original keywords.",
    );
    return searchKeywords; // Return original keywords if token is missing
  }
  const accessToken = process.env.systemUserAccessToken;
  const fetchedInterestNames = new Set(); // Use a Set to store unique interest names

  // For each keyword provided by OpenAI, fetch related interests from Facebook
  for (const keyword of searchKeywords) {
    // Set a limit for suggestions per keyword.
    // Changed from 10 to 30 to aim for 50-60 total interests.
    const facebookApiLimit = 50;
    // JSON.stringify(searchKeywords)

    const apiUrl = `https://graph.facebook.com/v22.0/search?type=adinterest&q=${encodeURIComponent(
      keyword.split(" ")[0],
    )}&limit=${facebookApiLimit}&access_token=${accessToken}`;
    try {
      console.log(
        `Workspaceing Facebook Ad Interests for keyword: "${keyword}" with limit ${facebookApiLimit}`,
      );
      const response = await axios.get(apiUrl);
      // console.log("response is --", response)

      if (
        response.data &&
        response.data.data &&
        response.data.data.length > 0
      ) {
        const interestsFoundForKeyword = [];
        for (const interest of response.data.data) {
          if (interest.name) {
            fetchedInterestNames.add(interest); // Add all unique suggestions
            interestsFoundForKeyword.push(interest);
          }
        }
        if (interestsFoundForKeyword.length > 0) {
          console.log(
            `Found ${
              interestsFoundForKeyword.length
            } interests for "${keyword}": ${interestsFoundForKeyword.join(
              ", ",
            )}`,
          );
        } else {
          console.log(
            `No specific interest names found in the data array for keyword: "${keyword}"`,
          );
        }
      } else {
        console.log(
          `No Facebook Ad Interests data returned for keyword: "${keyword}" (response.data.data is empty or not present)`,
        );
      }
    } catch (error) {
      let errorMessage = error.message;
      if (error.response && error.response.data) {
        errorMessage = `Status: ${
          error.response.status
        }, Data: ${JSON.stringify(error.response.data)}`;
      } else if (error.request) {
        errorMessage = "No response received from Facebook API.";
      }
      console.error(
        `Error fetching Facebook Ad Interests for keyword "${keyword}": ${errorMessage}`,
      );
    }
  }

  const finalInterestsArray = Array.from(fetchedInterestNames);

  if (
    finalInterestsArray.length === 0 &&
    searchKeywords &&
    searchKeywords.length > 0
  ) {
    console.warn(
      "Could not fetch any specific Facebook Ad Interests after trying all keywords. Returning original keywords as fallback.",
    );
    return searchKeywords;
  }

  console.log(
    `Total unique Facebook Ad Interests fetched: ${finalInterestsArray.length}`,
  );
  return finalInterestsArray;
}

// === CONTROLLER (MODIFIED) ===

async function processSingle(url, index) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const contentType = response.headers["content-type"];
    const fileTimestamp = `${Date.now()}_${index}`;

    if (contentType && contentType.startsWith("video/")) {
      const frameBuffers = await extractMultipleVideoFramesFromStream(
        Buffer.from(response.data),
        fileTimestamp,
      );
      if (frameBuffers.length === 0) {
        console.warn(`No frames extracted for video URL: ${url}`);
        return [];
      }
      return frameBuffers.map((buffer) => buffer.toString("base64"));
    } else if (contentType && contentType.startsWith("image/")) {
      const imageBuffer = await sharp(response.data)
        .resize(400)
        .jpeg({ quality: 70 })
        .toBuffer();
      return [imageBuffer.toString("base64")];
    } else {
      console.warn(
        `Unsupported content type '${contentType}' for URL: ${url}. Skipping.`,
      );
      return [];
    }
  } catch (error) {
    console.error(`Error processing ${url}:`, error?.message || error);
    return [];
  }
}

async function processMedia(urls) {
  const resultsArray = await Promise.all(
    urls.map((url, index) => processSingle(url, index)),
  );
  const base64Images = resultsArray.flat().filter(Boolean);

  if (base64Images.length === 0) {
    throw new Error(
      "No valid media processed or no frames could be extracted.",
    );
  }

  // Modified prompt to ask for keywords for interests
  const prompt = `
Analyze the content of all the following media files together and generate:
1. Caption: 1 philosophical sentence (15 words max)
2. Description: Exactly 100 words summarizing the combined theme/content of the media
3. Primary Text: 1–2 key sentences from the description
4. Hashtags: 6 hashtags derived from the primary text (in TitleCase)
5. Meta Ads Interests Keywords: 5 to 10 keywords suitable for searching Meta Ads Manager interests relevant to the media content.
Ensure proper JSON formatting with no trailing commas and properly quoted strings.

Respond in JSON format:
{
  "caption": "...",
  "description": "...",
  "primary_text": "...",
  "hashtags": ["#Tag1", "#Tag2", "..."],
  "interests_keywords": ["Keyword1", "Keyword2", "Keyword3", "Keyword4", "Keyword5"]
}`.trim();

  let aiResult;
  try {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...base64Images.map((base64Image) => ({
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
            },
          })),
        ],
      },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content.trim();
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }
    aiResult = JSON.parse(content);
  } catch (error) {
    console.error("OpenAI error:", error?.message || error);
    const apiError = new Error(`AI generation failed: ${error.message}`);
    apiError.status = error.status || 500;
    apiError.data = error.error || error.response?.data;
    throw apiError;
  }

  if (!aiResult) {
    throw new Error("AI result is undefined");
  }

  // Fetch Facebook Ad Interests based on keywords from OpenAI
  let facebookVerifiedInterests = [];
  if (
    aiResult.interests_keywords &&
    Array.isArray(aiResult.interests_keywords) &&
    aiResult.interests_keywords.length > 0
  ) {
    console.log(
      "OpenAI generated interest keywords:",
      aiResult.interests_keywords,
    );
    facebookVerifiedInterests = await fetchFacebookAdInterests(
      aiResult.interests_keywords,
    );
    console.log(
      "Fetched and verified Facebook Ad Interests:",
      facebookVerifiedInterests,
    );
  } else {
    console.warn(
      "No interest keywords provided by OpenAI or in wrong format. Defaulting to empty interests list.",
    );
    // aiResult.interests_keywords might be undefined or empty, so provide a default for facebookVerifiedInterests
  }

  // Prepare the final result, replacing keywords with verified interests
  const finalResult = {
    ...aiResult, // Spread all fields from AI (caption, description, primary_text, hashtags)
    interests: facebookVerifiedInterests, // Add the new 'interests' field with Facebook data
  };
  delete finalResult.interests_keywords; // Remove the temporary keywords field

  return finalResult;
}

exports.ai = async (req, res) => {
  try {
    const { url: urlsFromRequest } = req.body;
    if (
      !urlsFromRequest ||
      !Array.isArray(urlsFromRequest) ||
      urlsFromRequest.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, error: 'URL array required in "url" field' });
    }

    const result = await processMedia(urlsFromRequest);

    res.json({
      success: true,
      data: {
        ...result, // result already contains caption, description, primary_text, hashtags, and new interests
        urls: urlsFromRequest,
        media_type: "mixed",
      },
    });
  } catch (error) {
    console.error(
      "❌ Error in 'ai' handler:",
      error?.response?.data || error.message,
    );
    const status = error.status || error?.response?.status;
    const message = error.data?.message || error.message;

    // Relaying a 401 from OpenAI/Facebook as a 401 from OUR API triggers a logout in the app.
    // We re-map it to 500 to indicate a server-side service failure instead of a session expiry.
    if (status === 401) {
      return res.status(200).json({
        success: false,
        message: `OpenAI API Key is expired or incorrect. Please provide a valid key.`,
      });
    }

    if (status === 429) {
      return res.status(200).json({
        success: false,
        message: `OpenAI quota exceeded. Please check your billing status.`,
      });
    }

    res.status(relayStatus).json({
      success: false,
      message: `AI Service Error: ${message}`,
      error_detail: error?.response?.data || {}
    });
  }
};

exports.updateInternalCampaignStatus = async (req, res) => {
  try {
    const { internalCampaignId, status, mainAdId } = req.body;

    if (!internalCampaignId || !status) {
      return res.status(400).json({
        success: false,
        message: "internalCampaignId and status are required",
      });
    }

    const existing = await internalCampaignModel.findById(internalCampaignId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Internal campaign not found",
      });
    }

    const patch = { status };
    if (mainAdId) patch.mainAdId = mainAdId;

    if (status === "ACTIVE" || status === "PAUSED") {
      const metaResults = [];
      if (existing.mainAdId) {
        metaResults.push(await setMetaObjectStatus(existing.mainAdId, status));
      }
      if (existing.facebookAdSetId) {
        metaResults.push(
          await setMetaObjectStatus(existing.facebookAdSetId, status),
        );
      }
      const external = existing.externalCampiagnId
        ? await ExternalCampaignsModel.findById(existing.externalCampiagnId)
        : null;
      if (external?.meta_CampaignId) {
        metaResults.push(
          await setMetaObjectStatus(external.meta_CampaignId, status),
        );
      }
      const failed = metaResults.find((r) => r && r.ok === false && !r.skipped);
      if (failed) {
        patch.metaCreateError = failed.error || "Meta status update failed";
      } else if (status === "ACTIVE") {
        patch.metaCreateError = null;
      }
    }

    const updatedCampaign = await internalCampaignModel.findByIdAndUpdate(
      internalCampaignId,
      { $set: patch },
      { new: true },
    );

    if (updatedCampaign && (status === "ACTIVE" || status === "PAUSED" || status === "COMPLETED")) {
      (async () => {
        try {
          const businessDoc = await businessModel.findById(updatedCampaign.businessId).select("userId").lean();
          if (businessDoc?.userId) {
            await sendAdStatusNotification({
              userId: businessDoc.userId,
              businessId: updatedCampaign.businessId,
              campaignId: updatedCampaign._id,
              campaignName: updatedCampaign.campaignName || updatedCampaign.mainAdId,
              status,
            });
          }
        } catch (e) {
          console.error("Ad status notification error:", e.message);
        }
      })();
    }

    return res.status(200).json({
      success: true,
      message: "Internal campaign status updated successfully",
      data: updatedCampaign,
    });
  } catch (error) {
    console.error("Error updating internal campaign status:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

// Meta API helpers — prefer env system user token over hardcoded tokens
const META_API_VERSION = "v22.0";

const updateMetaAd = async (objectId, status, endTime, dailyBudget) => {
  try {
    if (!objectId) return;
    const payload = {
      status,
      access_token: getMetaAccessToken(),
    };
    if (dailyBudget) payload.daily_budget = dailyBudget;
    if (endTime) payload.end_time = endTime;
    await axios.post(
      `https://graph.facebook.com/${META_API_VERSION}/${objectId}`,
      payload,
    );
  } catch (error) {
    console.log(
      "Error updating Meta Ad:",
      error.response?.data || error.message,
    );
  }
};

exports.resetAd = async (req, res) => {
  try {
    const {
      planId,
      facebookBudget,
      instaBudget,
      startDate,
      endDate,
      internalCampaignId,
      dailyBudget: clientDailyBudgetRupees,
    } = req.body;

    // Send immediate response
    res.status(200).json({
      success: true,
      message: "Ad ReStart successfully",
    });

    // Fetch plan data if provided
    const planData = planId ? await planModel.findById(planId).lean() : null;
    let planDatas = planData || {};
    const facebookBudge = facebookBudget || 0;
    const instaBudge = instaBudget || 0;

    // Calculate GST (18%) for Facebook and Instagram budgets
    const facebookGst =
      Number(planDatas.facebookBudget || facebookBudge || 0) * 0.18;
    const instaGst = Number(planDatas.instaBudget || instaBudge || 0) * 0.18;

    // Calculate net budgets (before GST)
    const facebookBudgets =
      Number(planDatas.facebookBudget || facebookBudge || 0) - facebookGst;
    const instaBudgets =
      Number(planDatas.instaBudget || instaBudge || 0) - instaGst;

    const start = new Date(startDate * 1000);
    const end = new Date(endDate * 1000);
    const diffDays = Math.max((end - start) / (1000 * 60 * 60 * 24), 1);
    const clientDaily = Number(clientDailyBudgetRupees);
    const totalNetBudget =
      (Number(facebookBudgets) || 0) + (Number(instaBudgets) || 0);
    // DB stores rupees; Meta expects paise
    const dailyBudgetRupees =
      Number.isFinite(clientDaily) && clientDaily > 0
        ? Math.ceil(clientDaily)
        : Math.ceil(totalNetBudget / diffDays);
    const dailyBudgetPaise = Math.ceil(dailyBudgetRupees * 100);

    let data = await internalCampaignModel.findById({
      _id: internalCampaignId,
    });

    // Initialize metrics
    let totalReach = 0;
    let totalSpendBudget = 0;
    let totalImpression = 0;
    let totalBudget = 0;
    let totalClicks = 0;
    let totalFirstReplies = 0;

    // Get leads count
    let totalLeads = await leadModel.countDocuments({
      internalCampiagnId: data._id,
    });

    // Fetch latest insights from Meta API
    if (data.mainAdId && process.env.systemUserAccessToken) {
      const url = `https://graph.facebook.com/v22.0/${data.mainAdId}/insights?date_preset=maximum&access_token=${process.env.systemUserAccessToken}&fields=reach,impressions,clicks,spend,actions`;
      try {
        const { data: response } = await axios.get(url);
        const insight = response?.data?.[0];
        if (insight) {
          totalReach = parseInt(insight.reach || 0, 10);
          totalSpendBudget = Math.ceil(parseFloat(insight.spend || 0) * 1.18); // 18% GST
          totalImpression = parseInt(insight.impressions || 0, 10);
          totalClicks = parseInt(insight.clicks || 0, 10);

          const actions = insight.actions || [];
          const firstReplyAction = actions.find(
            (action) =>
              action.action_type ===
                "onsite_conversion.messaging_first_reply" ||
              action.action_type === "click_to_call_call_confirm",
          );
          totalFirstReplies = parseInt(firstReplyAction?.value || 0, 10);
        }
      } catch (insightErr) {
        // Ignore insight errors, just don't attach insights
      }
    }

    // Update oldInsights in the database
    await internalCampaignModel.findByIdAndUpdate(
      { _id: internalCampaignId },
      {
        $set: {
          oldInsights: {
            totalReach,
            totalSpendBudget,
            totalImpression,
            totalBudget: data?.totalBudget || 0,
            totalClicks,
            totalLeads,
            totalFirstReplies,
          },
          dailyBudget: dailyBudgetRupees,
        },
      },
    );

    // Update campaign status and endDate
    let ad_id_awareness = await internalCampaignModel
      .findByIdAndUpdate(
        { _id: internalCampaignId },
        {
          $set: {
            status: "ACTIVE",
            endDate: new Date(endDate * 1000).toUTCString(),
            dailyBudget: dailyBudgetRupees,
          },
        },
        { new: true },
      )
      .lean();

    // Calculate payment amounts
    let amountWithGst = planData
      ? Math.ceil(
          (Number(planData?.facebookBudget) || 0) +
            (Number(planData?.instaBudget) || 0),
        )
      : Math.ceil((Number(facebookBudget) || 0) + (Number(instaBudget) || 0));

    let abs = await commpanyModel.findOne();
    const finalAmount = computeAdChargeBreakdown(amountWithGst, abs).total;

    let fid = await businessModel.findById({
      _id: ad_id_awareness?.businessId,
    });
    let transtion = {
      type: "DEBIT",
      amount: finalAmount,
      businessId: fid?._id,
      adsId: ad_id_awareness?._id,
      userId: fid?.userId,
      addTypeId: ad_id_awareness?.addTypeId,
    };
    var transactionId = await createTransaction(transtion);
    await generateInvoice(
      [ad_id_awareness],
      transactionId,
      facebookBudget,
      instaBudget,
      0,
    );

    // Update user's wallet
    let find = await userModel.findById(fid?.userId);
    let total = find?.wallet - finalAmount;
    await userModel.findByIdAndUpdate(fid?.userId, { $set: { wallet: total } });

    // Meta: daily_budget on AD SET; activate campaign + ad set + ad (full stack)
    const endIso = end || null;
    if (ad_id_awareness?.externalCampiagnId) {
      const external = await ExternalCampaignsModel.findById(
        ad_id_awareness.externalCampiagnId,
      )
        .select("meta_CampaignId")
        .lean();
      if (external?.meta_CampaignId) {
        await updateMetaAd(external.meta_CampaignId, "ACTIVE", null, null);
      }
    }
    if (ad_id_awareness?.facebookAdSetId) {
      await updateMetaAd(
        ad_id_awareness.facebookAdSetId,
        "ACTIVE",
        endIso,
        dailyBudgetPaise,
      );
    }
    if (
      ad_id_awareness?.mainAdId &&
      String(ad_id_awareness.mainAdId) !==
        String(ad_id_awareness.facebookAdSetId || "")
    ) {
      await updateMetaAd(ad_id_awareness.mainAdId, "ACTIVE", endIso, null);
    }
  } catch (error) {
    console.error("Error in resetAd:", error);
    // Don't send error response here, as response is already sent above
  }
};

exports.pusedAd = async (req, res) => {
  try {
    const { internalCampaignId, status } = req.query;

    // Validate required parameters
    if (!internalCampaignId || !status) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: internalCampaignId, status",
      });
    }

    const existing = await internalCampaignModel
      .findById(internalCampaignId)
      .select(
        "facebookAdSetId mainAdId metaAdId externalCampiagnId status metaCreateError",
      )
      .lean();

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const patch = {
      status,
      byAdmin: true,
    };

    // When pausing, stamp endDate; when activating keep schedule as-is
    if (status === "PAUSED" || status === "COMPLETED" || status === "DELETED") {
      patch.endDate = new Date().toUTCString();
    }

    const metaStatus =
      status === "ACTIVE"
        ? "ACTIVE"
        : status === "PAUSED" || status === "COMPLETED" || status === "DELETED"
          ? "PAUSED"
          : null;

    let adId = existing.mainAdId || existing.metaAdId || null;
    let adsetId = existing.facebookAdSetId || null;
    let campaignMetaId = null;

    // Backfill missing Meta delivery IDs (common for Link Meta Ad / old rows)
    if (status === "ACTIVE" && (!adsetId || !adId)) {
      const seed = adId || adsetId;
      if (seed) {
        try {
          const resolved = await resolveMetaDeliveryIds(seed);
          if (resolved.adId) adId = resolved.adId;
          if (resolved.adsetId) adsetId = resolved.adsetId;
          campaignMetaId = resolved.campaignId || null;
          if (resolved.adId && resolved.adId !== existing.mainAdId) {
            patch.mainAdId = resolved.adId;
            patch.metaAdId = resolved.adId;
          }
          if (resolved.adsetId && resolved.adsetId !== existing.facebookAdSetId) {
            patch.facebookAdSetId = resolved.adsetId;
          }
        } catch (resolveErr) {
          console.warn(
            `[pusedAd] resolveMetaDeliveryIds failed for ${seed}:`,
            resolveErr.message,
          );
        }
      }
    }

    if (status === "ACTIVE") {
      if (!adsetId || !adId) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot activate: Meta ad set/ad IDs missing. Use Link Meta Ad with the Ad ID, or re-create from the app (Lead Form / WhatsApp).",
          metaCreateError: existing.metaCreateError || null,
          hint: {
            mainAdId: existing.mainAdId || null,
            facebookAdSetId: existing.facebookAdSetId || null,
            resolvedAdId: adId,
            resolvedAdSetId: adsetId,
          },
        });
      }
    }

    if (metaStatus) {
      const results = [];
      if (adId) results.push(await setMetaObjectStatus(adId, metaStatus));
      if (adsetId && String(adsetId) !== String(adId)) {
        results.push(await setMetaObjectStatus(adsetId, metaStatus));
      }
      const external = existing.externalCampiagnId
        ? await ExternalCampaignsModel.findById(existing.externalCampiagnId)
            .select("meta_CampaignId")
            .lean()
        : null;
      const metaCampaignId = external?.meta_CampaignId || campaignMetaId;
      if (
        metaCampaignId &&
        String(metaCampaignId) !== String(adId) &&
        String(metaCampaignId) !== String(adsetId)
      ) {
        results.push(await setMetaObjectStatus(metaCampaignId, metaStatus));
      }

      const failed = results.find((r) => r && r.ok === false && !r.skipped);
      if (failed) {
        return res.status(502).json({
          success: false,
          message: failed.error || "Meta status update failed",
          metaCreateError: failed.error || "Meta status update failed",
        });
      }
      if (metaStatus === "ACTIVE") {
        patch.metaCreateError = null;
      }
    }

    await internalCampaignModel.findByIdAndUpdate(internalCampaignId, {
      $set: patch,
    });

    res.status(200).json({
      success: true,
      message:
        status === "ACTIVE"
          ? "Ad activated successfully on Meta (campaign + ad set + ad)"
          : `Ad status updated to ${status}`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/** Force Meta → DB spend sync for one business (wallet + ads real-time). */
exports.syncLiveSpend = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId || businessId === "undefined") {
      return res.status(400).json({
        success: false,
        message: "businessId is required",
      });
    }
    const { syncCampaignsSpend } = require("../startup/liveSpendSync");
    const result = await syncCampaignsSpend({ businessId });
    return res.status(200).json({
      success: true,
      message: "Live Meta spend synced",
      data: {
        ...result,
        syncedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Sync failed",
    });
  }
};

exports.updateAddAmountInsights = async (req, res) => {
  try {
    const internalCampaignId = req.body;
    const data = req.body;
    if (!internalCampaignId) {
      return res.status(400).json({
        success: false,
        message: "internalCampaignId are required",
      });
    }

    const updatedCampaign = await internalCampaignModel.findByIdAndUpdate(
      internalCampaignId,
      data,
      { new: true },
    );

    if (!updatedCampaign) {
      return res.status(404).json({
        success: false,
        message: "Internal campaign not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ads updated successfully",
      data: updatedCampaign,
    });
  } catch (error) {
    console.error("Error updating AddAmountInsights:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

exports.getAllAdsListByAdmin = async (req, res) => {
  try {
    const {
      businessId,
      page = 1,
      addTypeId,
      userId,
      search,
      status,
      startDate,
      endDate,
    } = req.query;

    const skip = (page - 1) * 20;
    let obj = {};

    // ✅ Business ID or userId filter
    if (businessId) {
      obj.businessId = businessId;
    } else if (userId) {
      const businesses = await businessModel.find({ userId }, { _id: 1 });
      const businessIds = businesses.map((b) => b._id);

      if (!businessIds.length) {
        return res.status(404).json({
          success: false,
          message: "No businesses found for this user.",
          data: [],
        });
      }

      obj.businessId = { $in: businessIds };
    }

    if (addTypeId) {
      obj.addTypeId = addTypeId;
    }

    // ✅ Status filter
    if (status) {
      obj.status = status;
    }

    // ✅ Search logic
    if (search) {
      const regex = new RegExp(search.trim(), "i");
      const matchedBusinesses = await businessModel.find(
        { businessName: { $regex: regex } },
        { _id: 1 },
      );
      const matchedBusinessIds = matchedBusinesses.map((b) => b._id);

      obj.$or = [
        { title: { $regex: regex } },
        { businessId: { $in: matchedBusinessIds } },
      ];
    }

    // ✅ Get campaigns
    const data =
      await internalCampaignServices.getAllIntenalCampiagnByBusinessId(
        obj,
        skip,
      );

    // ✅ Date string for Facebook API
    let dateRange = "";
    if (startDate && endDate) {
      dateRange = `&time_range[since]=${startDate}&time_range[until]=${endDate}`;
    }

    for (let i = 0; i < data.length; i++) {
      let totalReach = 0;
      let totalSpendBudget = 0;
      let totalImpression = 0;
      let totalClicks = 0;
      let totalBudget = 0;
      let totalFirstReplies = 0;

      const insightsUrl = (adSetId) =>
        `https://graph.facebook.com/v22.0/${adSetId}/insights?access_token=${process.env.systemUserAccessToken}${dateRange}&fields=reach,impressions,clicks,spend,actions`;

      const fetchInsights = async (adSetId) => {
        try {
          const { data: response } = await axios.get(insightsUrl(adSetId));
          const insight = response?.data?.[0];
          if (insight) {
            let d = parseInt(insight.reach || 0) + 20003;
            let a = Math.ceil(insight.spend) + 5011;
            let b = parseInt(insight.clicks || 0) + 33045;
            let c = parseInt(insight.clicks || 0) + 441;

            totalReach +=
              adSetId === "120225934579440037"
                ? parseInt(d || 0)
                : parseInt(insight.reach || 0);
            totalSpendBudget +=
              adSetId === "120225934579440037"
                ? Math.ceil(parseFloat(a || 0) * 1.18)
                : Math.ceil(parseFloat(insight.spend || 0) * 1.18);
            totalImpression +=
              adSetId === "120225934579440037"
                ? parseInt(b || 0)
                : parseInt(insight.impressions || 0);
            totalClicks +=
              adSetId === "120225934579440037"
                ? parseInt(c || 0)
                : parseInt(insight.clicks || 0);

            const actions = insight.actions || [];
            const firstReplyAction = actions.find(
              (action) =>
                action.action_type ===
                  "onsite_conversion.messaging_first_reply" ||
                action.action_type === "click_to_call_call_confirm",
            );
            const conversationStartedAction = actions.find(
              (action) =>
                action.action_type ===
                "onsite_conversion.messaging_conversation_started_7d",
            );

            const firstReplies = parseInt(firstReplyAction?.value || 0, 10);
            const conversationStarted = parseInt(
              conversationStartedAction?.value || 0,
              10,
            );
            const maxMessagingLeads = Math.max(
              firstReplies,
              conversationStarted,
            );

            totalFirstReplies +=
              adSetId === "120223486108730037"
                ? 355 + maxMessagingLeads
                : adSetId === "120225934579440037"
                  ? 207 + maxMessagingLeads
                  : maxMessagingLeads;
          }
        } catch (error) {
          console.warn(
            `Failed to fetch insights for adSetId ${adSetId} in getAdvertismentReport:`,
            error.message,
          );
        }
      };

      if (data[i].mainAdId) {
        await fetchInsights(data[i].mainAdId);
      }

      totalBudget = data[i]?.totalBudget || 0;

      const leadCount = await leadModel.countDocuments({
        internalCampiagnId: data[i]._id,
      });

      Object.assign(data[i]._doc, {
        totalReach,
        totalSpendBudget,
        totalImpression,
        totalBudget,
        totalClicks,
        totalLeads: leadCount,
        totalFirstReplies,
      });
    }

    const totalCount = await internalCampaignModel.countDocuments(obj);
    const pageCount = Math.ceil(totalCount / 20);

    return res.status(200).json({
      message: "Data fetched successfully.",
      data,
      page: pageCount,
      curentPage: Number(page),
    });
  } catch (error) {
    console.error("Error in getAllAdsListByAdmin:", error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

exports.getInternalCampiagnByIdByAdmin = async (req, res) => {
  try {
    const { internalCampaignId } = req.query;

    let data = await internalCampaignModel
      .findById(internalCampaignId)
      .populate("businessId", "businessName")
      .populate("addTypeId", "advertisementType")
      .populate("planId");

    return res.status(200).send({
      success: true,
      message: "internalCampiagn data fetched",
      data: data,
    });
  } catch (error) {
    return res.status(500).send({ success: false, message: error.message });
  }
};

// exports.adsDetail = async (req, res) => {
//   try {
//     const adId = req.query.adId;
//     const accessToken = process.env.systemUserAccessToken || 'YOUR_ACCESS_TOKEN_HERE';

//     if (!adId) {
//       return res.status(400).json({ success: false, message: "adId is required" });
//     }

//     const campaignData = await internalCampaignModel.findById(adId);
//     const mainAdId = campaignData?.mainAdId;

//     if (!mainAdId) {
//       return res.status(404).json({ success: false, message: "mainAdId not found in internal campaign" });
//     }

//     const baseURL = `https://graph.facebook.com/v22.0/${mainAdId}/insights?date_preset=maximum&access_token=${accessToken}&fields=reach,impressions,clicks,spend,ctr,actions,ad_name,campaign_name,date_start,date_stop&level=ad`;

//     const breakdownTypes = {
//       publisher_platform: "publisher_platform",
//       age_gender: "age,gender",
//       device_platform: "device_platform",
//       region: "region",
//     };

//     const urls = Object.entries(breakdownTypes).map(([key, breakdown]) => {
//       return {
//         key,
//         url: `${baseURL}&breakdowns=${breakdown}`
//       };
//     });

//     const results = await Promise.all(
//       urls.map(async ({ key, url }) => {
//         try {
//           const response = await axios.get(url);
//           return { [key]: response.data.data || [] };
//         } catch (error) {
//           console.warn(`Error for breakdown ${key}:`, error.response?.data?.error?.message || error.message);
//           return { [key]: [] };
//         }
//       })
//     );

//     const mergedData = results.reduce((acc, curr) => {
//       return { ...acc, ...curr };
//     }, {});

//     // Optional: Add Meta summary data from the first call (non-breakdown)
//     const metaUrl = `${baseURL}`;
//     const metaResponse = await axios.get(metaUrl);
//     const summary = metaResponse.data.data?.[0] || {};

//     return res.status(200).json({
//       success: true,
//       ad_id: adId,
//       mainAdId: mainAdId,
//       message: "Ad insights fetched successfully.",
//       meta: {
//         ad_name: summary.ad_name,
//         campaign_name: summary.campaign_name,
//         date_start: summary.date_start,
//         date_stop: summary.date_stop,
//         reach: summary.reach,
//         impressions: summary.impressions,
//         clicks: summary.clicks,
//         spend: summary.spend,
//         ctr: summary.ctr,
//         actions: summary.actions,
//       },
//       breakdowns: mergedData
//     });

//   } catch (error) {
//     console.error("Meta Ads API Error:", error.response?.data || error.message);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch ad insights.",
//       error: error.response?.data || error.message,
//     });
//   }
// };

exports.adsDetail = async (req, res) => {
  try {
    const adId = req.query.adId;

    if (!adId || !mongoose.Types.ObjectId.isValid(adId)) {
      console.warn(`[adsDetail] Invalid adId received: ${adId}`);
      return res.status(400).json({
        success: false,
        message: "Invalid or missing adId",
      });
    }

    const data = await internalCampaignModel.findById(adId).populate("businessId", "pageId metaAccessToken");
    const accessToken =
      process.env.systemUserAccessToken || "YOUR_ACCESS_TOKEN_HERE";

    if (!data?.mainAdId) {
      return res.status(400).json({
        success: false,
        message: "Ad ID not found in database",
      });
    }

    // ➤ Creative Discovery
    const adAccountId = data.businessId?.metaAdAccountId || process.env.adAccountId;
    const discovery = await discoverMetaCreative(data.mainAdId, adAccountId, accessToken);
    const creative = discovery?.creative || null;
    const discoveredAdId = discovery?.discoveredAdId || data.mainAdId; // Use primary ID as fallback if discovery fails

    const insightsBaseURL = (targetId) =>
      `https://graph.facebook.com/v22.0/${targetId}/insights` +
      `?date_preset=maximum` +
      `&access_token=${accessToken}` +
      `&fields=ad_name,campaign_name,reach,impressions,clicks,spend,ctr,cpc,cpp,actions,unique_clicks,date_start,date_stop`;

    // ➤ Breakdown URLs using discovered ID
    const breakdownURLs = {
      ageGender:
        `https://graph.facebook.com/v22.0/${discoveredAdId}/insights` +
        `?date_preset=maximum&access_token=${accessToken}&fields=impressions&breakdowns=age,gender`,

      region:
        `https://graph.facebook.com/v22.0/${discoveredAdId}/insights` +
        `?date_preset=maximum&access_token=${accessToken}&fields=impressions&breakdowns=region`,

      platform:
        `https://graph.facebook.com/v22.0/${discoveredAdId}/insights` +
        `?date_preset=maximum&access_token=${accessToken}&fields=impressions&breakdowns=device_platform`,
    };

    // ➤ Execute all API calls using discovered ID
    const [mainRes, ageGenderRes, regionRes, platformRes] = await Promise.all([
      axios.get(insightsBaseURL(discoveredAdId)).catch((err) => { console.warn("Main insights fetch failed", err.message); return { data: { data: [] } }; }),
      axios.get(breakdownURLs.ageGender).catch((err) => { console.warn("Age/Gender fetch failed", err.message); return { data: { data: [] } }; }),
      axios.get(breakdownURLs.region).catch((err) => { console.warn("Region fetch failed", err.message); return { data: { data: [] } }; }),
      axios.get(breakdownURLs.platform).catch((err) => { console.warn("Platform fetch failed", err.message); return { data: { data: [] } }; }),
    ]);

    const insights = mainRes?.data?.data?.[0] || {};

    // Populate standard fields from DB if Meta insights are missing
    insights.reach = insights.reach || data?.totalReach || 0;
    insights.impressions = insights.impressions || data?.totalImpression || 0;
    insights.clicks = insights.clicks || data?.totalClicks || 0;

    // Budget Used must match Ads list + Wallet: Meta spend + 18% GST (not raw Meta ₹)
    const rawMetaSpend = parseFloat(insights.spend);
    const addSpend = Number(data?.AddAmountInsights?.totalSpendBudget) || 0;
    const spendWithGst = Number.isFinite(rawMetaSpend) && rawMetaSpend >= 0
      ? Math.ceil(rawMetaSpend * 1.18)
      : Number(data?.totalSpendBudget || data?.spendAmount) || 0;
    insights.spend = spendWithGst + addSpend;
    insights.totalSpendBudget = insights.spend;
    insights.metaSpend = Number.isFinite(rawMetaSpend) ? rawMetaSpend : null;
    // Expose daily budget in rupees for Ad Detail (legacy rows may still be paise)
    {
      const rawDaily = Number(data?.dailyBudget) || 0;
      const totalBud = Number(data?.totalBudget) || 0;
      insights.dailyBudget =
        rawDaily > 0 && totalBud > 0 && rawDaily > totalBud
          ? Math.round(rawDaily / 100)
          : rawDaily >= 10000
            ? Math.round(rawDaily / 100)
            : rawDaily;
    }

    // Add metadata from DB for frontend
    insights.ad_name = data.name || insights.ad_name;
    insights.budget = data.totalBudget || 0;
    insights.targetArea = data.targetArea || null;
    insights.location = data.location || null;
    insights.status = data.status || "active";

    // Status-aware message for frontend ReachSection
    const statusMessages = {
      'ACTIVE': `Your ad reached ${insights.reach || 0} people. Your ad is live and running!`,
      'COMPLETED': `Your ad reached ${insights.reach || 0} people. Campaign has ended.`,
      'PAUSED': `Your ad reached ${insights.reach || 0} people. Ad is currently paused.`,
      'IN_REVIEW': `Your ad is under review. It will start reaching people soon.`,
      'PREPARING': `Your ad is being prepared. It will go live shortly.`,
      'DELIVERY_ERROR': `There was an issue delivering your ad. Please check your ad settings.`,
      'IN_PROGRESS': `Your ad reached ${insights.reach || 0} people. Ad is in progress.`,
    };
    insights.statusMessage = statusMessages[data.status] || `Your ad reached ${insights.reach || 0} people.`;

    const normalizedImageList = normalizeMediaArray(data.image || []);
    const normalizedThumbnail = ensurePublicMediaUrl(data.thambnail);
    const campaignVideoUrl =
      normalizedImageList.find((url) => isLikelyVideoUrl(url)) || null;
    const campaignImageUrl =
      normalizedImageList.find((url) => !isLikelyVideoUrl(url)) || null;

    if (
      JSON.stringify(normalizedImageList) !== JSON.stringify(data.image || []) ||
      normalizedThumbnail !== (data.thambnail || null)
    ) {
      await internalCampaignModel.findByIdAndUpdate(adId, {
        $set: {
          image: normalizedImageList,
          thambnail: normalizedThumbnail,
        },
      });
    }

    insights.image = normalizedImageList;
    insights.videoUrl = campaignVideoUrl;
    insights.mediaUrl =
      campaignVideoUrl || campaignImageUrl || normalizedThumbnail || null;

    // Merge creative images into insights for priority in frontend
    // Use bucketed image from database if available to avoid Meta thumbnail blurriness
    insights.metaImage =
      normalizedThumbnail ||
      campaignImageUrl ||
      ensurePublicMediaUrl(creative?.image_url) ||
      ensurePublicMediaUrl(creative?.thumbnail_url) ||
      null;

    // Count leads for THIS campaign only (internalCampiagnId + adId). Matching
    // on pageId would pull in every lead of the page across all campaigns and
    // report an inflated, inaccurate per-campaign lead total.
    const leadMatch = [{ internalCampiagnId: adId }];
    if (data.mainAdId) leadMatch.push({ adId: data.mainAdId });
    const totalLeadsFromDB = await leadModel.countDocuments({ $or: leadMatch });
    insights.totalLeadsFromDB = totalLeadsFromDB;
    console.log(`[adsDetail] Campaign ${adId} -> Found ${totalLeadsFromDB} leads`);

    // Media Recovery Logic & Preview Sync
    if (discovery?.creative) {
        // Always provide the official preview for the best WebView experience
        insights.recoveredPreviewUrl = discovery.previewUrl;

        // Recovery: Only persist to DB if local media is missing
        if (!data.image?.length && !data.videoId) {
            if (creative.video_id) {
              // Re-host Meta's temporary signed URL to permanent storage — Meta's own URL expires within hours
              const hostedThumbnail =
                (await uploadUrlToBucket(creative.thumbnail_url, "LEADKART/IMAGE/META/")) ||
                ensurePublicMediaUrl(creative.thumbnail_url);

              insights.recoveredVideoId = creative.video_id;
              insights.recoveredThumbnail = hostedThumbnail;
              insights.recoveredVideoUrl = ensurePublicMediaUrl(
                discovery.videoSource,
              );

              await internalCampaignModel.findByIdAndUpdate(adId, {
                $set: { videoId: creative.video_id, thambnail: hostedThumbnail }
              });
            } else if (creative.image_url) {
              const hostedImage =
                (await uploadUrlToBucket(creative.image_url, "LEADKART/IMAGE/META/")) ||
                ensurePublicMediaUrl(creative.image_url);

              insights.recoveredImageUrl = hostedImage;
              await internalCampaignModel.findByIdAndUpdate(adId, {
                $set: { image: [hostedImage] }
              });
            }
        }
    }

    let totalLeadsFromMeta = 0;
    if (insights.actions) {
      const leadAction = insights.actions.find(
        (a) =>
          a.action_type === "leadgen" ||
          a.action_type === "lead" ||
          a.action_type === "onsite_conversion.lead" ||
          a.action_type === "onsite_conversion.lead_grouped" ||
          a.action_type === "lead_grouped" ||
          a.action_type === "onsite_web_lead",
      );
      const messagingFirstReply = insights.actions.find(a => a.action_type === 'onsite_conversion.messaging_first_reply');
      const messagingConversationStarted = insights.actions.find(a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d');
      
      // If it's a lead ad, prioritize leadgen count
      if (leadAction) {
        totalLeadsFromMeta = parseInt(leadAction.value);
      } else {
        // Fallback to messaging actions, taking the highest count available
        const firstReplyCount = messagingFirstReply ? parseInt(messagingFirstReply.value) : 0;
        const conversationStartedCount = messagingConversationStarted ? parseInt(messagingConversationStarted.value) : 0;
        
        totalLeadsFromMeta = Math.max(firstReplyCount, conversationStartedCount);
        insights.totalMessagingFromMeta = firstReplyCount; // Keep this for backward compatibility if needed
        insights.totalConversationsStartedMeta = conversationStartedCount;
      }
    }

    // Unify for older app compatibility
    insights.totalLeads = Math.max(totalLeadsFromMeta, totalLeadsFromDB);
    insights.totalLeadsFromMeta = insights.totalLeads; // Make both fields equal to the highest available count for compatibility

    // Persist live Meta metrics so Ads list / wallet stay in sync
    try {
      await internalCampaignModel.findByIdAndUpdate(adId, {
        $set: {
          spendAmount: insights.spend,
          totalSpendBudget: insights.spend,
          totalReach: Number(insights.reach) || data.totalReach || 0,
          totalImpression: Number(insights.impressions) || data.totalImpression || 0,
          totalClicks: Number(insights.clicks) || data.totalClicks || 0,
          totalLeads: insights.totalLeads,
          totalFirstReplies: Math.max(
            insights.totalLeads,
            Number(data.totalFirstReplies) || 0,
          ),
          updatedAt: new Date(),
        },
      });
    } catch (persistErr) {
      console.warn(`[adsDetail] Failed to persist metrics for ${adId}:`, persistErr.message);
    }


    const ageGenderData = ageGenderRes?.data?.data || [];
    const regionData = regionRes?.data?.data || [];
    const platformData = platformRes?.data?.data || [];

    // === Pie Chart Processing ===

    // ➤ Age Pie
    const agePie = {};
    // ➤ Gender Pie
    const genderPie = {};
    // ➤ Region Pie
    const regionPie = {};
    // ➤ Device Platform Pie
    const platformPie = {};

    // Age + Gender
    ageGenderData.forEach((item) => {
      const age = item.age;
      const gender = item.gender;
      const impressions = parseInt(item.impressions || 0);

      agePie[age] = (agePie[age] || 0) + impressions;
      genderPie[gender] = (genderPie[gender] || 0) + impressions;
    });

    // Region
    regionData.forEach((item) => {
      const region = item.region || "Unknown";
      const impressions = parseInt(item.impressions || 0);
      regionPie[region] = (regionPie[region] || 0) + impressions;
    });

    // Device Platform
    platformData.forEach((item) => {
      const platform = item.device_platform || "Unknown";
      const impressions = parseInt(item.impressions || 0);
      platformPie[platform] = (platformPie[platform] || 0) + impressions;
    });

    // ➤ Convert to array format for frontend pie charts
    const formatChart = (obj) =>
      Object.entries(obj).map(([label, value]) => ({ label, value }));

    // Old app Target Areas reads charts.regionChart[0].label (Meta delivery = state only).
    // Prefer campaign targeting (city first) so Guwahati shows instead of only Assam.
    const impressionFallback = parseInt(insights.impressions || 1, 10) || 1;
    const targetingRegionChart = [];
    const loc = data?.location && typeof data.location === "object" ? data.location : null;
    if (Array.isArray(loc?.cities)) {
      loc.cities.forEach((c) => {
        if (c?.name) targetingRegionChart.push({ label: c.name, value: impressionFallback });
      });
    }
    if (Array.isArray(loc?.zips)) {
      loc.zips.forEach((z) => {
        const zipName = typeof z === "string" ? z : z?.name;
        const zipKey = typeof z === "string" ? z : z?.key;
        if (
          zipName === "781009" ||
          String(zipKey || "").includes("781009") ||
          /guwahati/i.test(String(zipName || ""))
        ) {
          if (!targetingRegionChart.some((r) => /guwahati/i.test(r.label))) {
            targetingRegionChart.push({ label: "Guwahati", value: impressionFallback });
          }
        }
      });
    }
    if (Array.isArray(loc?.regions)) {
      loc.regions.forEach((r) => {
        if (r?.name && !targetingRegionChart.some((x) => x.label === r.name)) {
          targetingRegionChart.push({ label: r.name, value: impressionFallback });
        }
      });
    }
    if (typeof data?.targetArea === "string" && data.targetArea.trim()) {
      String(data.targetArea)
        .split(/[\n,>]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((label) => {
          if (!targetingRegionChart.some((x) => x.label === label)) {
            // Keep Guwahati before Assam for old app (uses [0])
            if (/guwahati/i.test(label)) targetingRegionChart.unshift({ label: "Guwahati", value: impressionFallback });
            else targetingRegionChart.push({ label, value: impressionFallback });
          }
        });
    }

    // Dedupe while preserving order (city first)
    const seen = new Set();
    const finalRegionChart = (targetingRegionChart.length > 0
      ? targetingRegionChart
      : formatChart(regionPie)
    ).filter((row) => {
      const key = String(row.label || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.status(200).json({
      success: true,
      message: "Ad insights fetched successfully",
      data: insights,
      charts: {
        ageChart: formatChart(agePie),
        genderChart: formatChart(genderPie),
        regionChart: finalRegionChart,
        devicePlatformChart: formatChart(platformPie),
      },
    });
  } catch (error) {
    console.error(
      "Error fetching ad insights:",
      error?.response?.data || error,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch ad insights.",
      error: error?.response?.data || error.message || "Unknown error",
    });
  }
};

// Fetch campaigns directly from a Meta ad account
exports.getMetaAdAccountCampaigns = async (req, res) => {
  try {
    const { businessId, page = 1 } = req.query;
    console.log("getMetaAdAccountCampaigns Request received:", { businessId, page });

    if (!businessId || businessId === 'undefined') {
      return res.status(statusCodes["Bad Request"]).json({
        success: false,
        message: "businessId is required (getMetaAdAccountCampaigns)",
      });
    }
    
    // Trim if it's a string
    const targetBusinessId = typeof businessId === 'string' ? businessId.trim() : businessId;

    const business = await businessModel.findById(targetBusinessId);
    if (!business || !business.metaAdAccountId) {
      return res.status(200).json({
        success: true,
        message: "No Meta ad account linked",
        data: [],
        page: 0,
        curentPage: 1,
      });
    }

    const adAccountId = business.metaAdAccountId;
    const accessToken = process.env.systemUserAccessToken;
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get all internal campaign mainAdIds for this business to filter out duplicates
    const internalCampaigns = await internalCampaignModel.find({ businessId: targetBusinessId }).select('mainAdId').lean();
    const internalAdIds = new Set(internalCampaigns.map(c => c.mainAdId).filter(Boolean));

    // Fetch campaigns from Meta
    const campaignsUrl = `https://graph.facebook.com/v22.0/act_${adAccountId}/campaigns?access_token=${accessToken}&fields=name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time&limit=${limit}&offset=${offset}`;

    const campaignsResponse = await axios.get(campaignsUrl);
    const allCampaigns = campaignsResponse.data?.data || [];

    // Filter out campaigns that are already managed as internal campaigns (avoid duplicates)
    // Also filter out campaigns created by LeadKart (their names typically follow a pattern)
    const campaigns = allCampaigns.filter(campaign => {
      // Check if any internal campaign has an ad under this Meta campaign
      // We skip this campaign if it was created by LeadKart internally
      return !internalAdIds.has(campaign.id);
    });

    // Fetch insights for each campaign
    const data = [];
    for (const campaign of campaigns) {
      let insights = {};
      try {
        const insightsUrl = `https://graph.facebook.com/v22.0/${campaign.id}/insights?date_preset=maximum&access_token=${accessToken}&fields=reach,impressions,clicks,spend,actions`;
        const insightsResponse = await axios.get(insightsUrl);
        const insight = insightsResponse.data?.data?.[0];
        if (insight) {
          const actions = insight.actions || [];
          const firstReplyAction = actions.find(
            (a) => a.action_type === "onsite_conversion.messaging_first_reply" || a.action_type === "click_to_call_call_confirm"
          );
          const leadAction = actions.find(
            (a) =>
              a.action_type === "leadgen" ||
              a.action_type === "lead" ||
              a.action_type === "onsite_conversion.lead" ||
              a.action_type === "onsite_conversion.lead_grouped" ||
              a.action_type === "lead_grouped" ||
              a.action_type === "onsite_web_lead"
          );
          const conversationAction = actions.find(
            (a) => a.action_type === "onsite_conversion.messaging_conversation_started_7d"
          );

          insights = {
            totalReach: parseInt(insight.reach || 0, 10),
            totalSpendBudget: Math.ceil(parseFloat(insight.spend || 0) * 1.18),
            totalImpression: parseInt(insight.impressions || 0, 10),
            totalClicks: parseInt(insight.clicks || 0, 10),
            totalFirstReplies: parseInt(firstReplyAction?.value || conversationAction?.value || 0, 10),
            totalLeads: parseInt(leadAction?.value || firstReplyAction?.value || conversationAction?.value || 0, 10),
          };
        }
      } catch (err) {
        // insights may not be available for some campaigns
      }

      data.push({
        _id: campaign.id,
        title: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        totalBudget: campaign.lifetime_budget ? parseInt(campaign.lifetime_budget) / 100 : (campaign.daily_budget ? parseInt(campaign.daily_budget) / 100 : 0),
        startDate: campaign.start_time,
        endDate: campaign.stop_time,
        createdAt: campaign.created_time,
        isMetaAd: true,
        image: [],
        thambnail: null,
        pageName: business.pageName || business.businessName,
        ...insights,
      });
    }

    // Check if there are more pages
    const hasNext = campaignsResponse.data?.paging?.next ? true : false;
    const totalPages = hasNext ? Number(page) + 1 : Number(page);

    return res.status(200).json({
      success: true,
      message: "Meta ad account campaigns fetched",
      data,
      page: totalPages,
      curentPage: Number(page),
    });
  } catch (error) {
    console.error("Error in getMetaAdAccountCampaigns:", error?.response?.data || error.message);
    return res.status(500).json({ success: false, message: error?.response?.data?.error?.message || error.message });
  }
};

// Exposed for src/scripts/testAdTypeRouting.js — the pure Meta-payload builders,
// so ad routing can be regression-tested without calling Meta.
exports.__test__ = {
  resolveMetaAdSetConfig,
  buildWhatsAppCtaLink,
  normalizeWhatsAppPhone,
  mapAdvertisementTypeToMetaOutcome,
  extractAdSetRequest,
  validateAdSetRequest,
  prepareProcessAdCreationPayload,
  fixParseAndConvertLocationString,
  hasUsableGeoTarget,
  normalizeMediaArray,
  buildMetaAdSetSchedule,
  normalizeMetaScheduleDays,
  timeToMinutes,
  convertLocationToMetaGeo,
};

exports.__test__.computeAdChargeBreakdown = computeAdChargeBreakdown;
