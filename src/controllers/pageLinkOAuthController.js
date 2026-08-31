const axios = require("axios");
const crypto = require("crypto");
const businessModel = require("../models/businessModel");
const PageLinkState = require("../models/pageLinkStateModel");

const GRAPH_VERSION = "v22.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Links a Facebook Page through Facebook Login for Business.
 *
 * The mobile SDK signs in with a plain `scope` list, which this app's login
 * cannot serve: asking for pages_manage_ads / leads_retrieval that way makes
 * Facebook's own dialog dead-end on "Sorry, something went wrong", and asking
 * for less silently returns whatever the user approved before — which is how
 * three relinks in a row produced the same seven permissions.
 *
 * Login for Business takes a `config_id` instead, and the configuration on the
 * dashboard decides the permissions. That cannot be expressed through
 * react-native-fbsdk-next, so the consent runs in the browser against this
 * backend, exactly as the WhatsApp embedded signup already does.
 */

const redirectUri = () =>
  process.env.PAGE_LINK_REDIRECT_URI ||
  "https://api.marketingkart.in/api/facebook/page/oauth/callback";

const configId = () =>
  process.env.PAGE_LINK_CONFIG_ID || process.env.META_LOGIN_CONFIG_ID;

/** Small HTML page shown in the browser once consent is done. */
const closingPage = (title, detail, ok = true) => `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font:16px -apple-system,system-ui,sans-serif;background:#F8F8F8;
       display:flex;align-items:center;justify-content:center;height:100vh}
  .c{background:#fff;border-radius:20px;padding:32px 24px;max-width:340px;text-align:center;
     box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .i{width:64px;height:64px;border-radius:32px;margin:0 auto 16px;line-height:64px;font-size:30px;
     background:${ok ? "#E8F5E9" : "#FDECEC"}}
  h1{font-size:19px;margin:0 0 8px;color:#1A1A1A}
  p{margin:0;color:#616161;line-height:1.5}
</style>
<div class="c"><div class="i">${ok ? "✅" : "⚠️"}</div>
<h1>${title}</h1><p>${detail}</p></div>`;

/**
 * Step 1 — hand the app a URL to open in the browser.
 */
exports.startPageLink = async (req, res) => {
  try {
    const { businessId } = req.body;
    const clientId = process.env.clientId || process.env.facebook_app_id;

    if (!businessId) {
      return res.status(400).json({ success: false, message: "businessId is required" });
    }
    if (!clientId) {
      return res.status(500).json({ success: false, message: "Meta app id is not configured on the server." });
    }
    if (!configId()) {
      return res.status(500).json({
        success: false,
        message:
          "Facebook login configuration id is not set. Add PAGE_LINK_CONFIG_ID to the server environment.",
      });
    }

    const state = crypto.randomBytes(32).toString("hex");
    await PageLinkState.create({
      state,
      businessId,
      userId: req.user?._id || null,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      // The configuration carries the permissions; a scope list here is what
      // breaks Login for Business.
      config_id: configId(),
      state,
    });

    return res.status(200).json({
      success: true,
      data: {
        oauthUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`,
        state,
      },
    });
  } catch (error) {
    console.error("[PageLink] start failed:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Step 2 — Facebook redirects the browser here. Exchange the code, keep the
 * user token against the state, and list the Pages the app may link.
 */
exports.handlePageLinkCallback = async (req, res) => {
  const { code, state, error: oauthError, error_description } = req.query;

  if (oauthError) {
    console.warn(`[PageLink] denied: ${oauthError} — ${error_description}`);
    return res.send(
      closingPage("Not connected", error_description || "You cancelled the Facebook login.", false),
    );
  }
  if (!code || !state) {
    return res.send(closingPage("Something is missing", "Facebook did not return an authorization code.", false));
  }

  try {
    const stateDoc = await PageLinkState.findOne({ state });
    if (!stateDoc) {
      return res.send(closingPage("Link expired", "Please start the connection again from the app.", false));
    }

    const { data: tokenRes } = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: {
        client_id: process.env.clientId || process.env.facebook_app_id,
        client_secret: process.env.clientSecret || process.env.facebook_app_secret,
        redirect_uri: redirectUri(),
        code,
      },
      timeout: 15000,
    });

    const userToken = tokenRes?.access_token;
    if (!userToken) {
      return res.send(closingPage("Could not finish", "Facebook did not return an access token.", false));
    }

    const { data: accounts } = await axios.get(`${GRAPH}/me/accounts`, {
      params: { fields: "id,name,access_token", limit: 200, access_token: userToken },
      timeout: 15000,
    });

    const pages = (accounts?.data || []).map((p) => ({ id: p.id, name: p.name }));

    await PageLinkState.updateOne(
      { _id: stateDoc._id },
      { $set: { userAccessToken: userToken, pages, completedAt: new Date() } },
    );

    return res.send(
      closingPage(
        "Facebook connected",
        pages.length
          ? "Return to the app to choose your Page."
          : "No Pages were found on this account. Return to the app.",
      ),
    );
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    console.error("[PageLink] callback failed:", detail);
    return res.send(closingPage("Could not finish", detail, false));
  }
};

/**
 * Step 3 — the app polls this while the browser is open, then links the chosen
 * Page through the normal business update path.
 */
exports.pageLinkStatus = async (req, res) => {
  try {
    const { state } = req.query;
    if (!state) {
      return res.status(400).json({ success: false, message: "state is required" });
    }

    const doc = await PageLinkState.findOne({ state }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: "This link attempt expired. Start again." });
    }

    return res.status(200).json({
      success: true,
      data: {
        done: Boolean(doc.completedAt),
        pages: doc.pages || [],
        // The token is what the app hands back to updateBussiness to finish the
        // link, which is the same path the SDK flow uses.
        metaAccessToken: doc.userAccessToken || null,
        businessId: doc.businessId,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
