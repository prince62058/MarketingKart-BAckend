const whatsappAccountModel = require("../models/whatsappAccountModel");
const whatsappCloudApiService = require("../services/whatsappCloudApiService");
const whatsappTemplateService = require("../services/whatsappTemplateService");
const axios = require("axios");

const PHONE_STATUS_SCORE = {
  CONNECTED: 50,
  VERIFIED: 40,
  PENDING: 10,
};

const PHONE_QUALITY_SCORE = {
  GREEN: 20,
  HIGH: 20,
  YELLOW: 10,
  MEDIUM: 10,
  RED: -10,
  LOW: -10,
};

const scorePhoneNumber = (phone = {}) => {
  const statusScore = PHONE_STATUS_SCORE[String(phone.status || "").toUpperCase()] || 0;
  const verificationScore =
    PHONE_STATUS_SCORE[String(phone.code_verification_status || "").toUpperCase()] || 0;
  const qualityScore = PHONE_QUALITY_SCORE[String(phone.quality_rating || "").toUpperCase()] || 0;
  const nameBonus = phone.verified_name ? 5 : 0;
  const displayBonus = phone.display_phone_number ? 5 : 0;

  return statusScore + verificationScore + qualityScore + nameBonus + displayBonus;
};

const selectPhoneNumber = (phoneNumbers = [], preferredPhoneNumberId = "") => {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;

  if (preferredPhoneNumberId) {
    const preferred = phoneNumbers.find((phone) => String(phone.id) === String(preferredPhoneNumberId));
    if (preferred) return preferred;
  }

  return [...phoneNumbers].sort((a, b) => scorePhoneNumber(b) - scorePhoneNumber(a))[0];
};

const isPhoneReadyForMessaging = (phone = {}) => {
  const phoneStatus = String(phone.status || "").toUpperCase();
  const verificationStatus = String(phone.code_verification_status || "").toUpperCase();

  return phoneStatus === "CONNECTED" || verificationStatus === "VERIFIED";
};

const buildAccountResponse = (account) => ({
  phoneNumber: account.phoneNumber,
  phoneNumberId: account.phoneNumberId,
  wabaId: account.wabaId,
  status: account.status,
  verifiedName: account.verifiedName || null,
  qualityRating: account.qualityRating || null,
  phoneStatus: account.phoneStatus || null,
  codeVerificationStatus: account.codeVerificationStatus || null,
  businessName: account.businessName || null,
  connectedVia: account.connectedVia || "MANUAL",
});

const fetchBusinessWabas = async ({ businessId, accessToken }) => {
  const endpoints = [
    "owned_whatsapp_business_accounts",
    "client_whatsapp_business_accounts",
  ];

  const discovered = new Map();

  for (const edge of endpoints) {
    try {
      const response = await axios.get(`https://graph.facebook.com/v21.0/${businessId}/${edge}`, {
        params: {
          access_token: accessToken,
          fields: "id,name",
        },
      });

      for (const waba of response.data?.data || []) {
        if (waba?.id) {
          discovered.set(String(waba.id), waba);
        }
      }
    } catch (error) {
      // Some businesses will not expose both edges. Ignore and continue discovery.
    }
  }

  return [...discovered.values()];
};

exports.connectAccount = async (req, res) => {
  try {
    const { phoneNumberId, wabaId, accessToken, phoneNumber } = req.body;
    const userId = req.user._id;

    if (!phoneNumberId || !wabaId || !accessToken) {
      return res.status(400).json({ success: false, message: "Missing required WhatsApp credentials" });
    }

    // Verify Meta details by checking fetch templates
    try {
      await whatsappCloudApiService.syncTemplatesFromMeta({ accessToken, wabaId });
    } catch (e) {
      console.error("[Account Connect] Access token validation failed:", e.message);
      return res.status(401).json({ success: false, message: "Invalid Meta credentials provided. Could not authenticate." });
    }

    const phoneNumbers = await whatsappCloudApiService.fetchPhoneNumbersFromMeta({ accessToken, wabaId });
    const selectedPhone = selectPhoneNumber(phoneNumbers, phoneNumberId);

    if (!selectedPhone || String(selectedPhone.id) !== String(phoneNumberId)) {
      return res.status(400).json({
        success: false,
        message: "The provided Phone Number ID does not belong to this WhatsApp Business Account.",
      });
    }

    if (!isPhoneReadyForMessaging(selectedPhone)) {
      return res.status(409).json({
        success: false,
        message:
          "Meta number found, but it is not ready for messaging yet. Number add karke OTP verification Meta side par complete karo, phir connect karo.",
      });
    }

    // Upsert the account mapping
    const account = await whatsappAccountModel.findOneAndUpdate(
      { userId },
      {
        phoneNumberId,
        wabaId,
        accessToken,
        phoneNumber: selectedPhone.display_phone_number || phoneNumber || null,
        verifiedName: selectedPhone.verified_name || null,
        qualityRating: selectedPhone.quality_rating || null,
        phoneStatus: selectedPhone.status || null,
        codeVerificationStatus: selectedPhone.code_verification_status || null,
        connectedVia: "MANUAL",
        status: "CONNECTED",
      },
      { new: true, upsert: true }
    );

    let templatesSynced = 0;
    try {
      templatesSynced = await whatsappTemplateService.syncFromMeta(
        { accessToken, wabaId },
        { createdBy: userId }
      );
    } catch (syncErr) {
      console.warn("[Account Connect] Template auto-sync failed:", syncErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "WhatsApp Account Connected Successfully",
      data: buildAccountResponse(account),
      templatesSynced,
    });
  } catch (error) {
    console.error("[Account Connect] Error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.connectViaFacebook = async (req, res) => {
  try {
    const { accessToken, preferredPhoneNumberId = "" } = req.body;
    const userId = req.user._id;

    if (!accessToken) {
      return res.status(400).json({ success: false, message: "Missing Facebook access token" });
    }

    console.log("[FB Auth] Step 1: Received access token from mobile, starting connect flow...");

    // ─── Step 1: Exchange short-lived token for long-lived token ─────────
    // CRITICAL FIX: Use the correct env var names (clientId / clientSecret)
    // instead of FB_APP_ID / FB_APP_SECRET which don't exist in .env
    const fbAppId = process.env.clientId;
    const fbAppSecret = process.env.clientSecret;
    let activeToken = accessToken;

    if (fbAppId && fbAppSecret) {
      try {
        console.log("[FB Auth] Step 2: Exchanging for long-lived token using clientId:", fbAppId);
        const exchangeRes = await axios.get(
          `https://graph.facebook.com/v21.0/oauth/access_token`, {
            params: {
              grant_type: "fb_exchange_token",
              client_id: fbAppId,
              client_secret: fbAppSecret,
              fb_exchange_token: accessToken,
            },
            timeout: 15000,
          }
        );
        if (exchangeRes.data?.access_token) {
          activeToken = exchangeRes.data.access_token;
          console.log("[FB Auth] ✅ Long-lived token obtained successfully.");
        }
      } catch (tokenErr) {
        console.warn("[FB Auth] ⚠️ Token exchange failed, using short-lived token.", tokenErr.response?.data || tokenErr.message);
      }
    } else {
      console.warn("[FB Auth] ⚠️ clientId / clientSecret not configured in .env — cannot exchange for long-lived token.");
    }

    // ─── Step 2: Discover WABAs via user's businesses ────────────────────
    const discoveredAccounts = [];

    // Strategy A: User's own businesses
    try {
      console.log("[FB Auth] Step 3: Fetching user's businesses via /me/businesses...");
      const bRes = await axios.get(`https://graph.facebook.com/v21.0/me/businesses`, {
        params: { access_token: activeToken },
        timeout: 15000,
      });
      const businesses = bRes.data?.data || [];
      console.log(`[FB Auth] Found ${businesses.length} businesses for user.`);

      for (const b of businesses) {
        try {
          const wabas = await fetchBusinessWabas({ businessId: b.id, accessToken: activeToken });
          console.log(`[FB Auth] Business "${b.name}" (${b.id}): ${wabas.length} WABA(s) found.`);

          for (const waba of wabas) {
            try {
              await whatsappCloudApiService.syncTemplatesFromMeta({
                accessToken: activeToken,
                wabaId: waba.id,
              });

              const phoneNumbers = await whatsappCloudApiService.fetchPhoneNumbersFromMeta({
                accessToken: activeToken,
                wabaId: waba.id,
              });

              const selectedPhone = selectPhoneNumber(phoneNumbers, preferredPhoneNumberId);
              if (!selectedPhone) continue;

              discoveredAccounts.push({
                businessName: b.name || null,
                wabaId: waba.id,
                wabaName: waba.name || null,
                phoneNumberId: selectedPhone.id,
                phoneNumber: selectedPhone.display_phone_number || null,
                verifiedName: selectedPhone.verified_name || null,
                qualityRating: selectedPhone.quality_rating || null,
                phoneStatus: selectedPhone.status || null,
                codeVerificationStatus: selectedPhone.code_verification_status || null,
                isReadyForMessaging: isPhoneReadyForMessaging(selectedPhone),
                score: scorePhoneNumber(selectedPhone),
                tokenUsed: activeToken,
              });
            } catch (innerWabaErr) {
              console.warn(`[FB Auth] Skip WABA ${waba.id}: ${innerWabaErr.message}`);
            }
          }
        } catch (innerErr) {
          console.warn(`[FB Auth] Skip business ${b.id}: ${innerErr.message}`);
        }
      }
    } catch (bizErr) {
      console.warn("[FB Auth] ⚠️ Could not fetch user's businesses:", bizErr.response?.data?.error?.message || bizErr.message);
    }

    // Strategy B: Fallback — use system businessId + system user token to discover WABAs
    // This covers the common case where the user just registered their WhatsApp number
    // via Meta's Embedded Signup but their personal token can't see the WABA yet.
    if (discoveredAccounts.length === 0) {
      console.log("[FB Auth] Step 3b: No WABAs found via user token. Trying system business fallback...");
      const systemBusinessId = process.env.businessId;
      const systemToken = process.env.systemUserAccessToken;

      if (systemBusinessId && systemToken) {
        try {
          const wabas = await fetchBusinessWabas({ businessId: systemBusinessId, accessToken: systemToken });
          console.log(`[FB Auth] System business ${systemBusinessId}: ${wabas.length} WABA(s) found.`);

          for (const waba of wabas) {
            try {
              const phoneNumbers = await whatsappCloudApiService.fetchPhoneNumbersFromMeta({
                accessToken: systemToken,
                wabaId: waba.id,
              });

              const selectedPhone = selectPhoneNumber(phoneNumbers, preferredPhoneNumberId);
              if (!selectedPhone) continue;

              discoveredAccounts.push({
                businessName: "LeadKart Business",
                wabaId: waba.id,
                wabaName: waba.name || null,
                phoneNumberId: selectedPhone.id,
                phoneNumber: selectedPhone.display_phone_number || null,
                verifiedName: selectedPhone.verified_name || null,
                qualityRating: selectedPhone.quality_rating || null,
                phoneStatus: selectedPhone.status || null,
                codeVerificationStatus: selectedPhone.code_verification_status || null,
                isReadyForMessaging: isPhoneReadyForMessaging(selectedPhone),
                score: scorePhoneNumber(selectedPhone),
                tokenUsed: systemToken,
              });
            } catch (wabaErr) {
              console.warn(`[FB Auth] System fallback: skip WABA ${waba.id}: ${wabaErr.message}`);
            }
          }
        } catch (sysErr) {
          console.warn("[FB Auth] System business fallback failed:", sysErr.message);
        }
      } else {
        console.warn("[FB Auth] ⚠️ System business fallback not available — businessId or systemUserAccessToken missing from .env");
      }
    }

    console.log(`[FB Auth] Step 4: Total discovered accounts: ${discoveredAccounts.length}`);

    if (!discoveredAccounts.length) {
      return res.status(404).json({
        success: false,
        message:
          "Koi WhatsApp Business number nahi mila. Pehle Meta Business Suite me jaakar apna WhatsApp number add karo aur OTP verify karo, phir yahan aa kar 'Continue with Facebook' dabao.",
      });
    }

    // ─── Step 3: Select the best account ──────────────────────────────────
    const readyAccounts = discoveredAccounts.filter((account) => account.isReadyForMessaging);
    const selectedAccount = (readyAccounts.length ? readyAccounts : discoveredAccounts)
      .sort((a, b) => b.score - a.score)[0];

    if (!selectedAccount?.isReadyForMessaging) {
      return res.status(409).json({
        success: false,
        message:
          "WhatsApp number mil gaya, lekin abhi messaging ke liye ready nahi hai. Meta side par number ka OTP verification complete karo, phir dobara connect karo.",
      });
    }

    console.log(`[FB Auth] Step 5: Selected phone ${selectedAccount.phoneNumber} (${selectedAccount.phoneNumberId}) from WABA ${selectedAccount.wabaId}`);

    // Use the token that was successful in discovering this account
    const tokenToStore = selectedAccount.tokenUsed || activeToken;

    // ─── Step 4: Save to DB ──────────────────────────────────────────────
    const account = await whatsappAccountModel.findOneAndUpdate(
      { userId },
      {
        phoneNumberId: selectedAccount.phoneNumberId,
        wabaId: selectedAccount.wabaId,
        accessToken: tokenToStore,
        phoneNumber: selectedAccount.phoneNumber,
        verifiedName: selectedAccount.verifiedName,
        qualityRating: selectedAccount.qualityRating,
        phoneStatus: selectedAccount.phoneStatus,
        codeVerificationStatus: selectedAccount.codeVerificationStatus,
        businessName: selectedAccount.businessName,
        connectedVia: "FACEBOOK",
        status: "CONNECTED"
      },
      { new: true, upsert: true }
    );

    let templatesSynced = 0;
    try {
      templatesSynced = await whatsappTemplateService.syncFromMeta(
        { accessToken: tokenToStore, wabaId: selectedAccount.wabaId },
        { createdBy: userId }
      );
    } catch (syncErr) {
      console.warn("[FB Auth] Template auto-sync failed:", syncErr.message);
    }

    console.log(`[FB Auth] ✅ Connected! Phone: ${selectedAccount.phoneNumber}, Templates synced: ${templatesSynced}`);

    return res.status(200).json({
      success: true,
      message: "Facebook se WhatsApp connect ho gaya! Account active hai.",
      data: buildAccountResponse(account),
      templatesSynced,
    });

  } catch (error) {
    console.error("[FB Auth] ❌ Fatal error:", error.response?.data || error.message);
    return res.status(500).json({ 
      success: false, 
      message: error.response?.data?.error?.message || error.message 
    });
  }
};

exports.getAccountDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const account = await whatsappAccountModel.findOne({ userId });

    if (!account) {
      return res.status(200).json({
        success: true,
        data: {
          phoneNumber: null,
          phoneNumberId: null,
          wabaId: null,
          status: "DISCONNECTED",
          verifiedName: null,
          qualityRating: null,
          phoneStatus: null,
          codeVerificationStatus: null,
          businessName: null,
          connectedVia: null,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: buildAccountResponse(account),
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.disconnectAccount = async (req, res) => {
  try {
    const userId = req.user._id;
    await whatsappAccountModel.findOneAndDelete({ userId });
    
    return res.status(200).json({ success: true, message: "WhatsApp Account Disconnected" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
