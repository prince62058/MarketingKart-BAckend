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
const OTP_BODY = "{{1}} is your verification code.";
const OTP_SECURITY_LINE = "For your security, do not share this code.";

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
function otpBodyText({ addSecurityRecommendation = true, codeExpirationMinutes } = {}) {
  const minutes = otpMinutes(codeExpirationMinutes);
  const lines = [addSecurityRecommendation !== false ? `${OTP_BODY} ${OTP_SECURITY_LINE}` : OTP_BODY];
  if (minutes) lines.push(`This code expires in ${minutes} minutes.`);
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
  typedButtons,
  detectTemplateType,
  flowIdOf,
};
