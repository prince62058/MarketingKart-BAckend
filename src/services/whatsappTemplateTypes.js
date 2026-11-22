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
function otpComponents({ addSecurityRecommendation = true, codeExpirationMinutes, otpButtonText } = {}) {
  const minutes = otpMinutes(codeExpirationMinutes);
  const components = [{ type: "BODY", add_security_recommendation: addSecurityRecommendation !== false }];
  if (minutes) components.push({ type: "FOOTER", code_expiration_minutes: minutes });
  components.push({
    type: "BUTTONS",
    buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: buttonText(otpButtonText, "Copy code") }],
  });
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
  if (buttons.length > 3) throw new TemplateTypeError("A template can have at most 3 buttons.");
  const cleaned = buttons.map((btn) => {
    const type = String(btn?.type || "").toUpperCase();
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
};
