const crypto = require("crypto");
const axios = require("axios");
const OAuthState = require("../models/oauthStateModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const whatsappCloudApiService = require("../services/whatsappCloudApiService");
const whatsappTemplateService = require("../services/whatsappTemplateService");

// ─── Constants ──────────────────────────────────────────────────────────────

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const DEEP_LINK_SCHEME = "myapp://whatsapp-connected";

// ─── Helper: Score & select best phone number (mirrors whatsappAccountController) ─

const PHONE_STATUS_SCORE = { CONNECTED: 50, VERIFIED: 40, PENDING: 10 };
const PHONE_QUALITY_SCORE = { GREEN: 20, HIGH: 20, YELLOW: 10, MEDIUM: 10, RED: -10, LOW: -10 };

const scorePhoneNumber = (phone = {}) => {
  const statusScore = PHONE_STATUS_SCORE[String(phone.status || "").toUpperCase()] || 0;
  const verificationScore = PHONE_STATUS_SCORE[String(phone.code_verification_status || "").toUpperCase()] || 0;
  const qualityScore = PHONE_QUALITY_SCORE[String(phone.quality_rating || "").toUpperCase()] || 0;
  const nameBonus = phone.verified_name ? 5 : 0;
  const displayBonus = phone.display_phone_number ? 5 : 0;
  return statusScore + verificationScore + qualityScore + nameBonus + displayBonus;
};

const selectPhoneNumber = (phoneNumbers = []) => {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;
  return [...phoneNumbers].sort((a, b) => scorePhoneNumber(b) - scorePhoneNumber(a))[0];
};

const isPhoneReadyForMessaging = (phone = {}) => {
  const phoneStatus = String(phone.status || "").toUpperCase();
  const verificationStatus = String(phone.code_verification_status || "").toUpperCase();
  return phoneStatus === "CONNECTED" || verificationStatus === "VERIFIED";
};

// ─── Helper: Build deep-link redirect URL ───────────────────────────────────

const buildDeepLink = (params = {}) => {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${DEEP_LINK_SCHEME}?${query}`;
};

// ─── Helper: Discover WABAs from user's businesses ──────────────────────────

const discoverWabas = async (accessToken) => {
  const discovered = [];

  try {
    // Fetch user's businesses
    const bizRes = await axios.get(`${GRAPH_API_BASE}/me/businesses`, {
      params: { access_token: accessToken, fields: "id,name" },
      timeout: 15000,
    });
    const businesses = bizRes.data?.data || [];
    console.log(`[Meta OAuth] Found ${businesses.length} businesses`);

    for (const biz of businesses) {
      // Try both owned and client WABAs
      for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        try {
          const wabaRes = await axios.get(`${GRAPH_API_BASE}/${biz.id}/${edge}`, {
            params: { access_token: accessToken, fields: "id,name" },
            timeout: 15000,
          });
          for (const waba of wabaRes.data?.data || []) {
            if (waba?.id) {
              discovered.push({ businessId: biz.id, businessName: biz.name, wabaId: waba.id, wabaName: waba.name });
            }
          }
        } catch (e) {
          // Edge might not be accessible — continue
        }
      }
    }
  } catch (err) {
    console.warn("[Meta OAuth] Could not fetch businesses:", err.response?.data?.error?.message || err.message);
  }

  // Fallback: try shared WABAs directly
  if (discovered.length === 0) {
    try {
      const sharedRes = await axios.get(`${GRAPH_API_BASE}/me/whatsapp_business_accounts`, {
        params: { access_token: accessToken, fields: "id,name" },
        timeout: 15000,
      });
      for (const waba of sharedRes.data?.data || []) {
        if (waba?.id) {
          discovered.push({ businessId: null, businessName: null, wabaId: waba.id, wabaName: waba.name });
        }
      }
    } catch (e) {
      // No shared WABAs either
    }
  }

  // Deduplicate by wabaId
  const unique = new Map();
  for (const d of discovered) {
    if (!unique.has(d.wabaId)) unique.set(d.wabaId, d);
  }
  return [...unique.values()];
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. START OAUTH — Generate OAuth URL & return to mobile
// ═══════════════════════════════════════════════════════════════════════════════

exports.startOAuth = async (req, res) => {
  try {
    const userId = req.user._id;
    const clientId = process.env.clientId;
    const redirectUri = process.env.META_OAUTH_REDIRECT_URI || "https://api.leadkart.in/api/whatsapp/meta/callback";
    const configId = process.env.META_CONFIG_ID;

    if (!clientId) {
      return res.status(500).json({ success: false, message: "Meta App (clientId) not configured on server." });
    }

    // Generate cryptographically secure state parameter
    const state = crypto.randomBytes(32).toString("hex");

    // Store state → userId mapping (TTL: 10 min)
    await OAuthState.findOneAndUpdate(
      { userId },
      { state, userId, createdAt: new Date() },
      { upsert: true, new: true }
    );

    // Build Meta OAuth URL
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "whatsapp_business_management,whatsapp_business_messaging",
      state,
    });

    // Add config_id for Embedded Signup if configured
    if (configId) {
      params.append("config_id", configId);
    }

    const oauthUrl = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;

    console.log(`[Meta OAuth] Generated OAuth URL for user ${userId}`);

    return res.status(200).json({
      success: true,
      data: {
        oauthUrl,
        state,
      },
    });
  } catch (error) {
    console.error("[Meta OAuth] startOAuth error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CALLBACK — Meta redirects here after user completes Embedded Signup
// ═══════════════════════════════════════════════════════════════════════════════

exports.handleCallback = async (req, res) => {
  const { code, state, error: oauthError, error_description } = req.query;

  // ─── Handle user cancellation or denial ────────────────────────────────────
  if (oauthError) {
    console.warn(`[Meta OAuth] User denied/cancelled: ${oauthError} — ${error_description}`);
    return res.redirect(
      buildDeepLink({
        status: oauthError === "access_denied" ? "cancelled" : "error",
        message: error_description || oauthError,
      })
    );
  }

  // ─── Validate required parameters ─────────────────────────────────────────
  if (!code || !state) {
    console.error("[Meta OAuth] Missing code or state in callback");
    return res.redirect(buildDeepLink({ status: "error", message: "Missing authorization code or state" }));
  }

  // ─── Validate state (CSRF protection) ─────────────────────────────────────
  let stateDoc;
  try {
    stateDoc = await OAuthState.findOneAndDelete({ state });
    if (!stateDoc) {
      console.error("[Meta OAuth] Invalid or expired state parameter");
      return res.redirect(buildDeepLink({ status: "error", message: "invalid_state" }));
    }
  } catch (err) {
    console.error("[Meta OAuth] State validation error:", err.message);
    return res.redirect(buildDeepLink({ status: "error", message: "state_validation_failed" }));
  }

  const userId = stateDoc.userId;
  const clientId = process.env.clientId;
  const clientSecret = process.env.clientSecret;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI || "https://api.leadkart.in/api/whatsapp/meta/callback";

  console.log(`[Meta OAuth] Processing callback for user ${userId}`);

  try {
    // ─── Step 1: Exchange authorization code for short-lived access token ────
    console.log("[Meta OAuth] Step 1: Exchanging code for access token...");
    const tokenRes = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      },
      timeout: 15000,
    });

    let accessToken = tokenRes.data?.access_token;
    if (!accessToken) {
      console.error("[Meta OAuth] No access token received from code exchange");
      return res.redirect(buildDeepLink({ status: "error", message: "token_exchange_failed" }));
    }
    console.log("[Meta OAuth] ✅ Short-lived token obtained");

    // ─── Step 2: Exchange for long-lived token ──────────────────────────────
    let tokenExpiresAt = null;
    try {
      console.log("[Meta OAuth] Step 2: Exchanging for long-lived token...");
      const longTokenRes = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: clientId,
          client_secret: clientSecret,
          fb_exchange_token: accessToken,
        },
        timeout: 15000,
      });

      if (longTokenRes.data?.access_token) {
        accessToken = longTokenRes.data.access_token;
        // Long-lived tokens expire in ~60 days
        const expiresIn = longTokenRes.data.expires_in || 5184000; // default 60 days
        tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
        console.log(`[Meta OAuth] ✅ Long-lived token obtained, expires: ${tokenExpiresAt.toISOString()}`);
      }
    } catch (longTokenErr) {
      console.warn("[Meta OAuth] ⚠️ Long-lived token exchange failed, using short-lived:", longTokenErr.response?.data?.error?.message || longTokenErr.message);
    }

    // ─── Step 3: Discover WABAs ─────────────────────────────────────────────
    console.log("[Meta OAuth] Step 3: Discovering WhatsApp Business Accounts...");
    const wabaList = await discoverWabas(accessToken);

    if (wabaList.length === 0) {
      // Fallback: try system token discovery (same as connectViaFacebook)
      const systemBusinessId = process.env.businessId;
      const systemToken = process.env.systemUserAccessToken;

      if (systemBusinessId && systemToken) {
        console.log("[Meta OAuth] No WABAs via user token, trying system business fallback...");
        for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
          try {
            const sysRes = await axios.get(`${GRAPH_API_BASE}/${systemBusinessId}/${edge}`, {
              params: { access_token: systemToken, fields: "id,name" },
              timeout: 15000,
            });
            for (const waba of sysRes.data?.data || []) {
              if (waba?.id) {
                wabaList.push({ businessId: systemBusinessId, businessName: "LeadKart Business", wabaId: waba.id, wabaName: waba.name });
              }
            }
          } catch (e) { /* skip */ }
        }
      }
    }

    if (wabaList.length === 0) {
      console.error("[Meta OAuth] No WABAs discovered");
      return res.redirect(buildDeepLink({ status: "error", message: "no_waba_found" }));
    }

    console.log(`[Meta OAuth] Found ${wabaList.length} WABA(s)`);

    // ─── Step 4: For each WABA, find phone numbers & select best ────────────
    let bestAccount = null;
    let bestScore = -Infinity;
    let tokenForBest = accessToken;

    for (const waba of wabaList) {
      try {
        // Try user token first, fallback to system token
        let phoneNumbers = [];
        let usedToken = accessToken;

        try {
          phoneNumbers = await whatsappCloudApiService.fetchPhoneNumbersFromMeta({
            accessToken,
            wabaId: waba.wabaId,
          });
        } catch (e) {
          // If user token fails, try system token
          const systemToken = process.env.systemUserAccessToken;
          if (systemToken) {
            phoneNumbers = await whatsappCloudApiService.fetchPhoneNumbersFromMeta({
              accessToken: systemToken,
              wabaId: waba.wabaId,
            });
            usedToken = systemToken;
          }
        }

        if (!phoneNumbers || phoneNumbers.length === 0) continue;

        const selected = selectPhoneNumber(phoneNumbers);
        if (!selected) continue;

        const score = scorePhoneNumber(selected);
        const ready = isPhoneReadyForMessaging(selected);

        if ((ready && score > bestScore) || (!bestAccount && score > bestScore)) {
          bestScore = score;
          bestAccount = {
            wabaId: waba.wabaId,
            businessName: waba.businessName || waba.wabaName || null,
            phoneNumberId: selected.id,
            phoneNumber: selected.display_phone_number || null,
            verifiedName: selected.verified_name || null,
            qualityRating: selected.quality_rating || null,
            phoneStatus: selected.status || null,
            codeVerificationStatus: selected.code_verification_status || null,
            isReady: ready,
          };
          tokenForBest = usedToken;
        }
      } catch (wabaErr) {
        console.warn(`[Meta OAuth] Skip WABA ${waba.wabaId}: ${wabaErr.message}`);
      }
    }

    if (!bestAccount) {
      console.error("[Meta OAuth] No usable phone number found in any WABA");
      return res.redirect(buildDeepLink({ status: "error", message: "no_phone_number_found" }));
    }

    if (!bestAccount.isReady) {
      console.warn("[Meta OAuth] Phone found but not ready for messaging");
      return res.redirect(
        buildDeepLink({
          status: "error",
          message: "phone_not_ready",
          phone: bestAccount.phoneNumber,
        })
      );
    }

    console.log(`[Meta OAuth] Step 5: Saving — Phone: ${bestAccount.phoneNumber}, WABA: ${bestAccount.wabaId}`);

    // ─── Step 5: Save to database ───────────────────────────────────────────
    await whatsappAccountModel.findOneAndUpdate(
      { userId },
      {
        phoneNumberId: bestAccount.phoneNumberId,
        wabaId: bestAccount.wabaId,
        accessToken: tokenForBest,
        phoneNumber: bestAccount.phoneNumber,
        verifiedName: bestAccount.verifiedName,
        qualityRating: bestAccount.qualityRating,
        phoneStatus: bestAccount.phoneStatus,
        codeVerificationStatus: bestAccount.codeVerificationStatus,
        businessName: bestAccount.businessName,
        connectedVia: "EMBEDDED_SIGNUP",
        status: "CONNECTED",
        ...(tokenExpiresAt && { tokenExpiresAt }),
      },
      { new: true, upsert: true }
    );

    // ─── Step 6: Auto-sync templates ────────────────────────────────────────
    let templatesSynced = 0;
    try {
      templatesSynced = await whatsappTemplateService.syncFromMeta(
        { accessToken: tokenForBest, wabaId: bestAccount.wabaId },
        { createdBy: userId }
      );
    } catch (syncErr) {
      console.warn("[Meta OAuth] Template auto-sync failed:", syncErr.message);
    }

    console.log(`[Meta OAuth] ✅ Connected! Phone: ${bestAccount.phoneNumber}, Templates: ${templatesSynced}`);

    // ─── Redirect to mobile app via deep link ───────────────────────────────
    return res.redirect(
      buildDeepLink({
        status: "success",
        phone: bestAccount.phoneNumber,
        waba_id: bestAccount.wabaId,
        business: bestAccount.businessName,
        templates_synced: templatesSynced,
      })
    );
  } catch (error) {
    console.error("[Meta OAuth] ❌ Callback fatal error:", error.response?.data || error.message);
    return res.redirect(
      buildDeepLink({
        status: "error",
        message: error.response?.data?.error?.message || error.message || "unexpected_error",
      })
    );
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. STATUS CHECK — Mobile polls this after deep link redirect
// ═══════════════════════════════════════════════════════════════════════════════

exports.checkStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const account = await whatsappAccountModel.findOne({ userId });

    if (!account || account.status !== "CONNECTED") {
      return res.status(200).json({
        success: true,
        data: {
          connected: false,
          status: "DISCONNECTED",
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        connected: true,
        status: account.status,
        phoneNumber: account.phoneNumber,
        phoneNumberId: account.phoneNumberId,
        wabaId: account.wabaId,
        verifiedName: account.verifiedName || null,
        qualityRating: account.qualityRating || null,
        phoneStatus: account.phoneStatus || null,
        businessName: account.businessName || null,
        connectedVia: account.connectedVia || null,
        tokenExpiresAt: account.tokenExpiresAt || null,
      },
    });
  } catch (error) {
    console.error("[Meta OAuth] checkStatus error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};
