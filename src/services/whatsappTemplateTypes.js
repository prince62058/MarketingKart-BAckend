// Template "types" as WhatsApp Manager offers them under each category:
//   Marketing:      Default, Catalogue, Flows, Calling permissions request
//   Utility:        Default, Flows, Calling permissions request
//   Authentication: One-time passcode
// Component shapes:
//   OTP (copy code): https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates.md
//   Catalog:         https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalog-template-messages.md
//   Call permission: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-call-permission-request-templates.md
//   Flow button:     https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flows-templates.md

const TEMPLATE_TYPES = {
  DEFAULT: { label: "Default", categories: ["MARKETING", "UTILITY"] },
  CATALOG: { label: "Catalogue", categories: ["MARKETING"] },
  FLOW: { label: "Flows", categories: ["MARKETING", "UTILITY"] },
  CALL_PERMISSION: { label: "Calling permissions request", categories: ["MARKETING", "UTILITY"] },
  OTP: { label: "One-time passcode", categories: ["AUTHENTICATION"] },
};

const BUTTON_TEXT_MAX = 25;
const BUTTONS_MAX = 10;

// WhatsApp writes the OTP sentence. These are the official lines for the
// languages the app offers, so the saved copy matches what the customer reads.
const OTP_COPY = {
  en_US: {
    body: "{{1}} is your verification code.",
    security: "For your security, do not share this code.",
    footer: (minutes) => `Expires in ${minutes} minutes.`,
    button: "Copy code",
  },
  en_GB: {
    body: "{{1}} is your verification code.",
    security: "For your security, do not share this code.",
    footer: (minutes) => `Expires in ${minutes} minutes.`,
    button: "Copy code",
  },
  hi: {
    body: "{{1}} आपका वेरिफ़िकेशन कोड है.",
    security: "अपनी सुरक्षा के लिए, इस कोड को किसी के साथ शेयर न करें.",
    footer: (minutes) => `${minutes} मिनट में समय-सीमा समाप्त हो जाएगी.`,
    button: "कोड कॉपी करें",
  },
  gu: {
    body: "{{1}} એ તમારો ખાતરીનો કોડ છે.",
    security: "તમારી સુરક્ષા માટે, આ કોડ કોઈની સાથે શેર કરશો નહિ.",
    footer: (minutes) => `${minutes} મિનિટમાં સમય પૂરો થશે.`,
    button: "કોડ કોપિ કરો",
  },
  bn: {
    body: "আপনার যাচাইকরণের কোড {{1}}",
    security: "আপনার নিরাপত্তার জন্য এই কোড শেয়ার করবেন না।",
    footer: (minutes) => `${minutes} মিনিটের মধ্যে মেয়াদ শেষ হয়ে যাবে।`,
    button: "কোড কপি করুন",
  },
  mr: {
    body: "{{1}} हा तुमचा व्हेरिफिकेशन कोड आहे.",
    security: "तुमच्या सुरक्षेसाठी हा कोड शेअर करू नका.",
    footer: (minutes) => `${toDevanagariDigits(minutes)} मिनिटांमध्ये एक्स्पायर होईल.`,
    button: "कोड कॉपी करा",
  },
  te: {
    body: "{{1}} మీ వెరిఫికేషన్ కోడ్.",
    security: "మీ భద్రత కోసం ఈ కోడ్‌ను షేర్ చేయవద్దు.",
    footer: (minutes) => `${minutes} నిమిషాల్లో గడువు ముగుస్తుంది.`,
    button: "కోడ్‌ను కాపీ చేయండి",
  },
  ta: {
    body: "{{1}} என்பது உங்கள் சரிபார்ப்புக் குறியீடாகும்.",
    security: "பாதுகாப்பு நோக்கங்களுக்காக, இந்தக் குறியீட்டைப் பகிர வேண்டாம் என்று கேட்டுக் கொள்கிறோம்.",
    footer: (minutes) => `${minutes} நிமிடங்களில் காலாவதியாகும்.`,
    button: "குறியீட்டை நகலெடு",
  },
};

function toDevanagariDigits(value) {
  const digits = "०१२३४५६७८९";
  return String(value).replace(/\d/g, (digit) => digits[Number(digit)]);
}

function otpCopy(language) {
  return OTP_COPY[language] || OTP_COPY.en_US;
}

class TemplateTypeError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** The type to build, checked against the category (an authentication template is always an OTP). */
function resolveType(templateType, category) {
  const cat = String(category || "").toUpperCase();
  const type = String(templateType || (cat === "AUTHENTICATION" ? "OTP" : "DEFAULT")).toUpperCase();
  const spec = TEMPLATE_TYPES[type];
  if (!spec) throw new TemplateTypeError(`Unknown template type: ${type}.`);
  if (!spec.categories.includes(cat)) {
    const allowed = spec.categories.map((c) => c.charAt(0) + c.slice(1).toLowerCase()).join(" or ");
    throw new TemplateTypeError(`${spec.label} templates must be in the ${allowed} category.`);
  }
  return type;
}

function buttonText(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim() || fallback;
  if (text.length > BUTTON_TEXT_MAX) {
    throw new TemplateTypeError(`Button text can be at most ${BUTTON_TEXT_MAX} characters.`);
  }
  return text;
}

function otpMinutes(value) {
  if (value === undefined || value === null || value === "") return null;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 90) {
    throw new TemplateTypeError("Code expiry must be a whole number of minutes from 1 to 90.");
  }
  return minutes;
}

/** Meta fixes the body of an authentication template; only these options can be set. */
function otpComponents({ addSecurityRecommendation = true, codeExpirationMinutes, otpButtonText, otpType, packageName, signatureHash, autofillText } = {}) {
  const minutes = otpMinutes(codeExpirationMinutes);
  const components = [{ type: "BODY", add_security_recommendation: addSecurityRecommendation !== false }];
  if (minutes) components.push({ type: "FOOTER", code_expiration_minutes: minutes });
  const kind = String(otpType || "COPY_CODE").toUpperCase();
  if (!["COPY_CODE", "ONE_TAP", "ZERO_TAP"].includes(kind)) throw new TemplateTypeError("Choose copy-code, one-tap or zero-tap delivery.");
  const button = { type: "OTP", otp_type: kind, text: buttonText(otpButtonText, "Copy code") };
  if (kind !== "COPY_CODE") {
    // One-tap and zero-tap hand the code to the user's Android app, so Meta needs that app.
    const pkg = String(packageName || "").trim();
    const hash = String(signatureHash || "").trim();
    if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg)) throw new TemplateTypeError("Enter your Android app's package name, for example com.example.app.");
    if (!/^[A-Za-z0-9+/]{11}$/.test(hash)) throw new TemplateTypeError("The app signature hash is 11 characters, from the Android app helper.");
    button.autofill_text = buttonText(autofillText, "Autofill");
    button.supported_apps = [{ package_name: pkg, signature_hash: hash }];
    if (kind === "ZERO_TAP") button.zero_tap_terms_accepted = true;
  }
  components.push({ type: "BUTTONS", buttons: [button] });
  return components;
}

/** What the customer will read, for the app's list and preview (Meta writes the real text). */
function otpBodyText({ addSecurityRecommendation = true, codeExpirationMinutes, language } = {}) {
  const minutes = otpMinutes(codeExpirationMinutes);
  const copy = otpCopy(language);
  const lines = [addSecurityRecommendation !== false ? `${copy.body} ${copy.security}` : copy.body];
  if (minutes) lines.push(copy.footer(minutes));
  return lines.join("\n");
}

/**
 * The BUTTONS for a Flows or Catalogue template: `meta` goes to Meta, `local` is what we store.
 * `flow` is { _id, metaFlowId, firstScreen } for a published flow.
 */
function typedButtons(type, { flow, flowButtonText, catalogButtonText } = {}) {
  if (type === "FLOW") {
    if (!flow?.metaFlowId) throw new TemplateTypeError("Choose a published flow for the form button.");
    const text = buttonText(flowButtonText, "Open form");
    const metaButton = { type: "FLOW", text, flow_id: String(flow.metaFlowId) };
    // Without a known first screen, Meta opens the flow's first screen by default.
    if (flow.firstScreen) Object.assign(metaButton, { flow_action: "navigate", navigate_screen: flow.firstScreen });
    return {
      meta: [metaButton],
      local: [{ type: "FLOW", text, flowId: flow._id || null, metaFlowId: String(flow.metaFlowId) }],
    };
  }
  if (type === "CATALOG") {
    const text = buttonText(catalogButtonText, "View catalog");
    return { meta: [{ type: "CATALOG", text }], local: [{ type: "CATALOG", text }] };
  }
  return null;
}

/** Works out the type of a template that came from Meta (for example one made in WhatsApp Manager). */
function detectTemplateType(components = [], category = "") {
  if (String(category).toUpperCase() === "AUTHENTICATION") return "OTP";
  const list = Array.isArray(components) ? components : [];
  if (list.some((c) => String(c?.type || "").toUpperCase() === "CALL_PERMISSION_REQUEST")) return "CALL_PERMISSION";
  const buttons = list.find((c) => String(c?.type || "").toUpperCase() === "BUTTONS")?.buttons || [];
  const buttonTypes = buttons.map((b) => String(b?.type || "").toUpperCase());
  if (buttonTypes.includes("FLOW")) return "FLOW";
  if (buttonTypes.includes("CATALOG") || buttonTypes.includes("MPM")) return "CATALOG";
  return "DEFAULT";
}

/** Rewrite {{3}} {{1}} into {{1}} {{2}} in the order they appear. WhatsApp rejects gaps. */
function renumberVariables(text) {
  const seen = [];
  return String(text || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (match, digits) => {
    const key = String(Number(digits));
    let index = seen.indexOf(key);
    if (index === -1) {
      seen.push(key);
      index = seen.length - 1;
    }
    return `{{${index + 1}}}`;
  });
}

/**
 * Shape a marketing or utility template the way WhatsApp's review accepts it.
 * A variable at the start or end, a gapped {{1}} {{3}}, a spaced phone number,
 * or a link example that is not a real URL are rejected before anyone reads the copy.
 */
function normalizeTemplateCopy({ bodyText, headerType, headerText, footerText, buttons } = {}) {
  let body = renumberVariables(String(bodyText || "").replace(/\r\n/g, "\n").trim().replace(/\n{3,}/g, "\n\n"));
  if (/^\{\{\d+\}\}/.test(body)) body = `Hi ${body}`;
  if (/\{\{\d+\}\}\s*$/.test(body)) body = `${body}.`;
  if (!body.replace(/\{\{\d+\}\}/g, "").trim()) {
    throw new TemplateTypeError("Write the message around the variables. It cannot be only {{1}}.");
  }
  if (body.length > 1024) throw new TemplateTypeError("The message can be at most 1024 characters.");

  let header = String(headerText || "").replace(/\s+/g, " ").trim();
  if (String(headerType || "").toUpperCase() === "TEXT") {
    if (!header) throw new TemplateTypeError("Enter the header text, or choose no header.");
    header = renumberVariables(header);
    const headerVars = header.match(/\{\{\d+\}\}/g) || [];
    if (headerVars.length > 1) throw new TemplateTypeError("A text header can use only one variable.");
    if (/^\{\{\d+\}\}/.test(header) || /\{\{\d+\}\}$/.test(header)) {
      throw new TemplateTypeError("Put words before and after the header variable.");
    }
    if (header.length > 60) throw new TemplateTypeError("Header text can be at most 60 characters.");
  }

  let footer = String(footerText || "").replace(/\s+/g, " ").trim();
  if (footer) {
    if (/\{\{\d+\}\}/.test(footer)) throw new TemplateTypeError("The footer cannot contain a variable. Put {{1}} in the message instead.");
    if (footer.length > 60) footer = footer.slice(0, 60);
  }

  return {
    bodyText: body,
    headerText: header,
    footerText: footer,
    buttons: normalizeButtons(buttons),
  };
}

function normalizeButtons(buttons) {
  if (!Array.isArray(buttons) || buttons.length === 0) return [];
  if (buttons.length > BUTTONS_MAX) throw new TemplateTypeError(`A template can have at most ${BUTTONS_MAX} buttons.`);
  const count = (type) => buttons.filter((b) => String(b?.type || "").toUpperCase() === type).length;
  if (count("URL") > 2) throw new TemplateTypeError("A template can have at most 2 link buttons.");
  if (count("PHONE_NUMBER") > 1) throw new TemplateTypeError("A template can have only 1 call button.");
  if (count("COPY_CODE") > 1) throw new TemplateTypeError("A template can have only 1 copy code button.");
  const cleaned = buttons.map((btn) => {
    const type = String(btn?.type || "").toUpperCase();
    if (type === "COPY_CODE") {
      const example = String(btn.example || btn.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{1,15}$/.test(example)) throw new TemplateTypeError("The offer code is 1 to 15 letters or numbers, no spaces (e.g. SUMMER20).");
      return { type: "COPY_CODE", example };
    }
    if (type === "FLOW") {
      const flowId = String(btn.flowId || "");
      if (!/^[a-f0-9]{24}$/i.test(flowId)) throw new TemplateTypeError("Choose a published form for the form button.");
      const text = String(btn?.text || "").replace(/\s+/g, " ").trim().slice(0, 25);
      if (!text) throw new TemplateTypeError("Every button needs a label.");
      const screen = String(btn.navigateScreen || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      return { type: "FLOW", text, flowId, ...(screen ? { navigateScreen: screen } : {}) };
    }
    const text = String(btn?.text || "").replace(/\s+/g, " ").trim().slice(0, 25);
    if (!text) throw new TemplateTypeError("Every button needs a label.");
    if (type === "URL") {
      let url = String(btn.url || "").trim();
      if (!url) throw new TemplateTypeError("Enter a website for the link button.");
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      try {
        // A variable is not a valid URL character, so check the sample address.
        // eslint-disable-next-line no-new
        new URL(url.replace(/\{\{\s*\d+\s*\}\}/g, "sample"));
      } catch {
        throw new TemplateTypeError("The link button needs a full website address, starting with https://.");
      }
      return { ...btn, type: "URL", text, url: renumberVariables(url) };
    }
    if (type === "PHONE_NUMBER") {
      let phone = String(btn.phoneNumber || "").replace(/[^\d+]/g, "");
      if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
      if (/^\d{10}$/.test(phone)) phone = `+91${phone}`;
      if (!phone.startsWith("+")) phone = `+${phone}`;
      if (!/^\+\d{8,15}$/.test(phone)) {
        throw new TemplateTypeError("Enter the call button with a country code, for example +919876543210.");
      }
      return { ...btn, type: "PHONE_NUMBER", text, phoneNumber: phone };
    }
    if (type === "QUICK_REPLY") return { ...btn, type: "QUICK_REPLY", text };
    return null;
  }).filter(Boolean);

  const labels = new Set();
  for (const button of cleaned) {
    if (!button.text) continue;
    const label = button.text.toLowerCase();
    if (labels.has(label)) throw new TemplateTypeError("Two buttons cannot have the same label.");
    labels.add(label);
  }
  // WhatsApp rejects a quick reply sitting between two link or call buttons.
  const callsToAction = cleaned.filter((button) => button.type !== "QUICK_REPLY");
  const replies = cleaned.filter((button) => button.type === "QUICK_REPLY");
  return [...callsToAction, ...replies];
}

const TEMPLATE_REJECT_TEXT = {
  INVALID_FORMAT: "WhatsApp rejected the format. Check the header, the buttons and the variables, then submit it again.",
  TAG_CONTENT_MISMATCH: "WhatsApp said this message does not match the category you chose.",
  INCORRECT_CATEGORY: "WhatsApp said this message belongs in a different category.",
  ABUSIVE_CONTENT: "WhatsApp rejected this message.",
  SCAM: "WhatsApp rejected this message.",
  NONE: "",
};

function templateRejectText(reason) {
  const code = String(reason || "").trim();
  if (!code || code === "NONE") return "";
  return TEMPLATE_REJECT_TEXT[code] || code.replace(/_/g, " ");
}

/** The Meta flow id behind a template's FLOW button, if it has one. */
function flowIdOf(components = []) {
  const buttons = (Array.isArray(components) ? components : []).find((c) => String(c?.type || "").toUpperCase() === "BUTTONS")?.buttons || [];
  const flowButton = buttons.find((b) => String(b?.type || "").toUpperCase() === "FLOW" && b.flow_id);
  return flowButton ? String(flowButton.flow_id) : null;
}


/* ---------- Named variables, Meta buttons, location, Limited-Time Offer, carousel ---------- */
const NAMED_VAR = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g;

/** {{first_name}} style names in order of first use. */
function namedVars(text) {
  const out = [];
  for (const m of String(text || "").matchAll(NAMED_VAR)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Meta's named-parameter examples; every name needs a sample value. */
function namedExamples(text, values = {}) {
  return namedVars(text).map((name) => {
    const example = String(values?.[name] ?? "").trim();
    if (!example) throw new TemplateTypeError(`Add a sample value for {{${name}}}.`);
    return { param_name: name, example };
  });
}

/** A normalised button as Meta's template API wants it. FLOW buttons need `metaFlowId` set first. */
function metaButton(btn) {
  if (btn.type === "QUICK_REPLY") return { type: "QUICK_REPLY", text: btn.text };
  if (btn.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: btn.text, phone_number: btn.phoneNumber };
  if (btn.type === "COPY_CODE") return { type: "COPY_CODE", example: btn.example };
  if (btn.type === "FLOW") {
    if (!btn.metaFlowId) throw new TemplateTypeError("Choose a published form for the form button.");
    const out = { type: "FLOW", text: btn.text, flow_id: String(btn.metaFlowId) };
    const screen = btn.navigateScreen || btn.firstScreen;
    if (screen) Object.assign(out, { flow_action: "navigate", navigate_screen: screen });
    return out;
  }
  if (btn.type === "URL") {
    const out = { type: "URL", text: btn.text, url: btn.url };
    // The example is the full link with the variable filled, not a second website pasted in.
    if (btn.url && btn.url.includes("{{")) out.example = [btn.url.replace(/\{\{\d+\}\}/g, "sample")];
    return out;
  }
  return null;
}

/** A location header. `_location` stays in our copy so sends can fill it; it is stripped before Meta. */
function locationHeader(location = {}) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (location.latitude === "" || location.latitude == null || !(latitude >= -90 && latitude <= 90)) throw new TemplateTypeError("Enter a latitude between -90 and 90.");
  if (location.longitude === "" || location.longitude == null || !(longitude >= -180 && longitude <= 180)) throw new TemplateTypeError("Enter a longitude between -180 and 180.");
  return {
    type: "HEADER",
    format: "LOCATION",
    _location: { latitude, longitude, name: String(location.name || "").trim().slice(0, 1000), address: String(location.address || "").trim().slice(0, 1000) },
  };
}

/** The limited_time_offer component, after checking the rest of the template fits Meta's LTO rules. */
function limitedTimeOffer(lto = {}, { category, headerType, footerText, buttons = [], bodyText = "" } = {}) {
  if (String(category || "").toUpperCase() !== "MARKETING") throw new TemplateTypeError("A Limited-Time Offer must be a Marketing template.");
  const text = String(lto.text || "").trim();
  if (!text || text.length > 16) throw new TemplateTypeError("Offer details text is 1 to 16 characters.");
  if (!["NONE", "IMAGE", "VIDEO", ""].includes(String(headerType || "NONE").toUpperCase())) throw new TemplateTypeError("Limited-Time Offer templates can only have an image or video header.");
  if (String(footerText || "").trim()) throw new TemplateTypeError("Limited-Time Offer templates can't have a footer.");
  if (String(bodyText).length > 600) throw new TemplateTypeError("A Limited-Time Offer message can be at most 600 characters.");
  const types = buttons.map((b) => b.type);
  if (!types.includes("COPY_CODE") || !types.includes("URL")) throw new TemplateTypeError("A Limited-Time Offer needs a copy offer code button and a link button.");
  if (types.some((t) => t !== "COPY_CODE" && t !== "URL")) throw new TemplateTypeError("A Limited-Time Offer can only have the copy code and link buttons.");
  return { type: "limited_time_offer", limited_time_offer: { text, has_expiration: Boolean(lto.hasExpiration) } };
}

/**
 * The carousel component: 2–10 cards, each a photo or video, a short text and 1–2 buttons,
 * every card with the same button types in the same order. Card media links stay in
 * `example.header_handle` (turned into WhatsApp handles at upload) and in `_mediaUrl` for sends.
 */
function carouselComponent(cards, { category, named = false } = {}) {
  if (String(category || "").toUpperCase() !== "MARKETING") throw new TemplateTypeError("Carousel templates must be Marketing templates.");
  if (!Array.isArray(cards) || cards.length < 2 || cards.length > 10) throw new TemplateTypeError("A carousel needs 2 to 10 cards.");
  let shape = null;
  const out = cards.map((card, i) => {
    const n = i + 1;
    const format = String(card?.mediaType || "IMAGE").toUpperCase();
    if (!["IMAGE", "VIDEO"].includes(format)) throw new TemplateTypeError(`Card ${n}: choose an image or a video.`);
    const mediaUrl = String(card?.mediaUrl || "").trim();
    if (!/^https:\/\//i.test(mediaUrl)) throw new TemplateTypeError(`Card ${n}: upload the ${format === "IMAGE" ? "image" : "video"} first.`);
    const text = renumberVariables(String(card?.bodyText || "").trim());
    if (!text) throw new TemplateTypeError(`Card ${n}: write the card text.`);
    if (text.length > 160) throw new TemplateTypeError(`Card ${n}: card text can be at most 160 characters.`);
    const buttons = normalizeButtons(card?.buttons || []);
    if (!buttons.length || buttons.length > 2) throw new TemplateTypeError(`Card ${n}: add 1 or 2 buttons.`);
    if (buttons.some((b) => !["QUICK_REPLY", "URL", "PHONE_NUMBER"].includes(b.type))) throw new TemplateTypeError(`Card ${n}: card buttons can be quick reply, link or call.`);
    const thisShape = buttons.map((b) => b.type).join(",");
    if (shape === null) shape = thisShape;
    else if (shape !== thisShape) throw new TemplateTypeError("Every carousel card must have the same buttons, in the same order.");
    const body = { type: "body", text };
    if (named) {
      const ex = namedExamples(text, card.exampleNamedValues || {});
      if (ex.length) body.example = { body_text_named_params: ex };
    } else {
      const vars = (text.match(/\{\{\d+\}\}/g) || []).length;
      if (vars) {
        const ex = (card.exampleBodyValues || []).map((v) => String(v || "").trim());
        if (ex.length < vars || ex.slice(0, vars).some((v) => !v)) throw new TemplateTypeError(`Card ${n}: add a sample value for every variable.`);
        body.example = { body_text: [ex.slice(0, vars)] };
      }
    }
    return {
      components: [
        { type: "header", format, example: { header_handle: [mediaUrl] }, _mediaUrl: mediaUrl },
        body,
        { type: "buttons", buttons: buttons.map(metaButton) },
      ],
    };
  });
  return { type: "carousel", cards: out };
}

module.exports = {
  TEMPLATE_TYPES,
  TemplateTypeError,
  resolveType,
  otpComponents,
  otpBodyText,
  otpCopy,
  typedButtons,
  detectTemplateType,
  flowIdOf,
  normalizeTemplateCopy,
  templateRejectText,
  namedVars,
  namedExamples,
  metaButton,
  locationHeader,
  limitedTimeOffer,
  carouselComponent,
};
