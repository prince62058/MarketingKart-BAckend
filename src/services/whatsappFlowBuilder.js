// Turns the app's simple form definition into WhatsApp Flow JSON (static flows, no data endpoint),
// and turns a completed flow's response back into readable answers.
// Flow JSON reference: https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson

const flowJsonVersion = () => process.env.WHATSAPP_FLOW_JSON_VERSION || "7.3";

const CATEGORIES = [
  "SIGN_UP",
  "SIGN_IN",
  "APPOINTMENT_BOOKING",
  "LEAD_GENERATION",
  "CONTACT_US",
  "CUSTOMER_SUPPORT",
  "SURVEY",
  "OTHER",
];

// labelMax values are Meta's component limits (TextInput/TextArea/Dropdown labels are 20 characters).
const FIELD_TYPES = {
  text: { component: "TextInput", inputType: "text", labelMax: 20, helper: true },
  email: { component: "TextInput", inputType: "email", labelMax: 20, helper: true },
  phone: { component: "TextInput", inputType: "phone", labelMax: 20, helper: true },
  number: { component: "TextInput", inputType: "number", labelMax: 20, helper: true },
  textarea: { component: "TextArea", labelMax: 20, helper: true },
  dropdown: { component: "Dropdown", labelMax: 20, options: { min: 1, max: 50 } },
  radio: { component: "RadioButtonsGroup", labelMax: 30, options: { min: 1, max: 20 } },
  checkbox: { component: "CheckboxGroup", labelMax: 30, options: { min: 1, max: 20 } },
  date: { component: "DatePicker", labelMax: 40, helper: true },
  optin: { component: "OptIn", labelMax: 120 },
};

const LIMITS = {
  name: 200,
  screens: 8,
  fieldsPerScreen: 15,
  title: 30,
  heading: 80,
  body: 1000,
  button: 35,
  helper: 80,
  optionTitle: 30,
};

const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const cleanBody = (value) => (typeof value === "string" ? value.replace(/\r/g, "").trim() : "");

// a, b, ... z, aa, ab ... (letters only: screen ids and generated names never need digits)
const letters = (index) => {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
};

const screenId = (index) => `SCREEN_${letters(index).toUpperCase()}`;

const NAME_RE = /^[a-z][a-z0-9_]{0,29}$/;

const slug = (text, fallback) => {
  const base = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return /^[a-z]/.test(base) ? base : fallback;
};

const claim = (base, used) => {
  let name = base;
  for (let i = 1; used.has(name); i += 1) name = `${base}_${letters(i)}`;
  used.add(name);
  return name;
};

function normalizeField(raw, where, usedNames, errors) {
  const type = String(raw?.type || "").toLowerCase();
  const spec = FIELD_TYPES[type];
  if (!spec) {
    errors.push({ path: `${where}.type`, message: "Choose a field type" });
    return null;
  }

  const label = clean(raw.label);
  if (!label) errors.push({ path: `${where}.label`, message: "Field label is required" });
  else if (label.length > spec.labelMax) {
    errors.push({ path: `${where}.label`, message: `Label can be at most ${spec.labelMax} characters` });
  }

  const wanted = typeof raw.name === "string" && NAME_RE.test(raw.name) && !usedNames.has(raw.name) ? raw.name : null;
  const name = wanted ? claim(wanted, usedNames) : claim(slug(label, "field"), usedNames);
  const field = { type, name, label, required: Boolean(raw.required) };

  if (spec.helper) {
    const helperText = clean(raw.helperText);
    if (helperText.length > LIMITS.helper) {
      errors.push({ path: `${where}.helperText`, message: `Hint can be at most ${LIMITS.helper} characters` });
    }
    if (helperText) field.helperText = helperText;
  }

  if (spec.options) {
    const usedIds = new Set();
    const seenTitles = new Set();
    const options = [];
    for (const [oi, option] of (Array.isArray(raw.options) ? raw.options : []).entries()) {
      const title = clean(typeof option === "string" ? option : option?.title);
      if (!title) continue;
      const key = title.toLowerCase();
      if (seenTitles.has(key)) {
        errors.push({ path: `${where}.options[${oi}]`, message: `"${title}" is listed twice` });
        continue;
      }
      seenTitles.add(key);
      if (title.length > LIMITS.optionTitle) {
        errors.push({ path: `${where}.options[${oi}]`, message: `Option can be at most ${LIMITS.optionTitle} characters` });
      }
      const givenId = typeof option?.id === "string" && NAME_RE.test(option.id) && !usedIds.has(option.id) ? option.id : null;
      options.push({ id: givenId ? claim(givenId, usedIds) : claim(slug(title, "option"), usedIds), title });
    }
    if (options.length < spec.options.min) {
      errors.push({ path: `${where}.options`, message: "Add at least one option" });
    } else if (options.length > spec.options.max) {
      errors.push({ path: `${where}.options`, message: `At most ${spec.options.max} options are allowed` });
    }
    field.options = options;
  }
  return field;
}

/**
 * Validates the app's form definition and fills in stable field names and option ids.
 * Returns { definition, errors }; errors carry a path the app can point at.
 */
function normalizeDefinition(raw) {
  const errors = [];
  const input = Array.isArray(raw?.screens) ? raw.screens : [];
  if (!input.length) errors.push({ path: "screens", message: "Add at least one screen" });
  if (input.length > LIMITS.screens) {
    errors.push({ path: "screens", message: `A flow can have at most ${LIMITS.screens} screens` });
  }

  const usedNames = new Set();
  const screens = input.slice(0, LIMITS.screens).map((screen, si) => {
    const where = `screens[${si}]`;
    const last = si === Math.min(input.length, LIMITS.screens) - 1;
    const title = clean(screen?.title) || "Form";
    const heading = clean(screen?.heading);
    const body = cleanBody(screen?.body);
    const buttonLabel = clean(screen?.buttonLabel) || (last ? "Submit" : "Continue");

    if (title.length > LIMITS.title) errors.push({ path: `${where}.title`, message: `Title can be at most ${LIMITS.title} characters` });
    if (heading.length > LIMITS.heading) errors.push({ path: `${where}.heading`, message: `Heading can be at most ${LIMITS.heading} characters` });
    if (body.length > LIMITS.body) errors.push({ path: `${where}.body`, message: `Text can be at most ${LIMITS.body} characters` });
    if (buttonLabel.length > LIMITS.button) errors.push({ path: `${where}.buttonLabel`, message: `Button text can be at most ${LIMITS.button} characters` });

    const rawFields = Array.isArray(screen?.fields) ? screen.fields : [];
    if (rawFields.length > LIMITS.fieldsPerScreen) {
      errors.push({ path: `${where}.fields`, message: `A screen can have at most ${LIMITS.fieldsPerScreen} fields` });
    }
    const fields = rawFields
      .slice(0, LIMITS.fieldsPerScreen)
      .map((field, fi) => normalizeField(field, `${where}.fields[${fi}]`, usedNames, errors))
      .filter(Boolean);
    if (!heading && !body && !fields.length) {
      errors.push({ path: where, message: "Add a heading, some text or a field to this screen" });
    }
    return { title, heading, body, buttonLabel, fields };
  });

  return { definition: { screens }, errors };
}

function fieldComponent(field) {
  const spec = FIELD_TYPES[field.type];
  const component = { type: spec.component, name: field.name, label: field.label, required: field.required };
  if (spec.inputType) component["input-type"] = spec.inputType;
  if (field.helperText) component["helper-text"] = field.helperText;
  if (spec.options) component["data-source"] = field.options.map(({ id, title }) => ({ id, title }));
  return component;
}

/**
 * Flow JSON for a normalized definition. Every screen but the last navigates to the next one;
 * the last completes the flow and sends every answer back (earlier screens are read with
 * ${screen.<ID>.form.<name>}, which Flow JSON supports from version 4.0).
 */
function buildFlowJson(definition) {
  const screens = definition.screens;
  const lastIndex = screens.length - 1;
  return {
    version: flowJsonVersion(),
    screens: screens.map((screen, index) => {
      const children = [];
      if (screen.heading) children.push({ type: "TextHeading", text: screen.heading });
      if (screen.body) children.push({ type: "TextBody", text: screen.body });
      for (const field of screen.fields) children.push(fieldComponent(field));

      let action;
      if (index === lastIndex) {
        const payload = {};
        screens.forEach((s, si) =>
          s.fields.forEach((f) => {
            payload[f.name] = si === lastIndex ? `\${form.${f.name}}` : `\${screen.${screenId(si)}.form.${f.name}}`;
          })
        );
        action = { name: "complete", payload };
      } else {
        action = { name: "navigate", next: { type: "screen", name: screenId(index + 1) }, payload: {} };
      }
      children.push({ type: "Footer", label: screen.buttonLabel, "on-click-action": action });

      const out = { id: screenId(index), title: screen.title, layout: { type: "SingleColumnLayout", children } };
      if (index === lastIndex) {
        out.terminal = true;
        out.success = true;
      }
      return out;
    }),
  };
}

const humanize = (key) => {
  const text = String(key || "").replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Answer";
};

function formatValue(field, raw) {
  if (raw === null || raw === undefined) return "";
  const titleOf = (value) => field?.options?.find((o) => o.id === String(value))?.title || String(value);
  if (Array.isArray(raw)) return raw.map(titleOf).join(", ");
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "object") return JSON.stringify(raw).slice(0, 500);
  return field?.options ? titleOf(raw) : String(raw).slice(0, 500);
}

/** Readable answers for a completed flow (labels and option titles from our stored definition). */
function describeAnswers(definition, response) {
  const fields = (definition?.screens || []).flatMap((s) => s.fields || []);
  const byName = new Map(fields.map((f) => [f.name, f]));
  const answers = [];
  for (const [key, raw] of Object.entries(response || {})) {
    if (key === "flow_token") continue;
    const field = byName.get(key);
    const value = formatValue(field, raw);
    if (value === "") continue;
    answers.push({ key, label: field?.label || humanize(key), value });
  }
  return answers;
}

const field = (type, label, required, extra = {}) => ({ type, label, required, ...extra });

// Starting points that mirror WhatsApp Manager's "without endpoint" flow templates.
const STARTERS = [
  {
    key: "LEAD_FORM",
    title: "Lead form",
    description: "Collect name, phone, email and what the customer wants.",
    category: "LEAD_GENERATION",
    definition: {
      screens: [
        {
          title: "Get a call back",
          heading: "Tell us about you",
          body: "Share your details and our team will contact you.",
          buttonLabel: "Submit",
          fields: [
            field("text", "Full name", true),
            field("phone", "Phone number", true),
            field("email", "Email", false),
            field("dropdown", "Interested in", true, { options: ["Product", "Service", "Pricing", "Other"] }),
          ],
        },
      ],
    },
  },
  {
    key: "PURCHASE_INTEREST",
    title: "Collect purchase interest",
    description: "Ask what they want to buy, their budget and when to call.",
    category: "LEAD_GENERATION",
    definition: {
      screens: [
        {
          title: "Your interest",
          heading: "What are you looking for?",
          buttonLabel: "Continue",
          fields: [
            field("radio", "Choose a product", true, { options: ["Product A", "Product B", "Product C"] }),
            field("dropdown", "Budget", false, { options: ["Under ₹5,000", "₹5,000 - ₹20,000", "Above ₹20,000"] }),
          ],
        },
        {
          title: "Contact details",
          heading: "How can we reach you?",
          buttonLabel: "Submit",
          fields: [
            field("text", "Full name", true),
            field("phone", "Phone number", true),
            field("dropdown", "Best time to call", false, { options: ["Morning", "Afternoon", "Evening"] }),
          ],
        },
      ],
    },
  },
  {
    key: "FEEDBACK",
    title: "Get feedback",
    description: "A rating and a comment after a purchase or visit.",
    category: "SURVEY",
    definition: {
      screens: [
        {
          title: "Feedback",
          heading: "How was your experience?",
          buttonLabel: "Send feedback",
          fields: [
            field("radio", "Your rating", true, { options: ["Excellent", "Good", "Average", "Poor"] }),
            field("textarea", "Comments", false),
          ],
        },
      ],
    },
  },
  {
    key: "SURVEY",
    title: "Send a survey",
    description: "A few multiple-choice questions.",
    category: "SURVEY",
    definition: {
      screens: [
        {
          title: "Quick survey",
          heading: "Help us serve you better",
          buttonLabel: "Submit",
          fields: [
            field("radio", "How did you find us?", true, { options: ["Facebook", "Instagram", "Google", "A friend"] }),
            field("checkbox", "What do you like?", false, { options: ["Price", "Quality", "Service", "Delivery"] }),
            field("textarea", "Suggestions", false),
          ],
        },
      ],
    },
  },
  {
    key: "SUPPORT",
    title: "Customer support",
    description: "Let customers describe a problem with their order.",
    category: "CUSTOMER_SUPPORT",
    definition: {
      screens: [
        {
          title: "Support",
          heading: "How can we help?",
          buttonLabel: "Submit",
          fields: [
            field("dropdown", "Issue type", true, { options: ["Order", "Payment", "Delivery", "Other"] }),
            field("text", "Order ID", false),
            field("textarea", "Describe the issue", true),
          ],
        },
      ],
    },
  },
  {
    key: "APPOINTMENT",
    title: "Appointment request",
    description: "Name, phone, preferred date and time slot.",
    category: "APPOINTMENT_BOOKING",
    definition: {
      screens: [
        {
          title: "Book a visit",
          heading: "Request an appointment",
          buttonLabel: "Request",
          fields: [
            field("text", "Full name", true),
            field("phone", "Phone number", true),
            field("date", "Preferred date", true),
            field("dropdown", "Preferred time", true, { options: ["10 AM - 12 PM", "12 PM - 3 PM", "3 PM - 6 PM"] }),
          ],
        },
      ],
    },
  },
  {
    key: "BLANK",
    title: "Start from scratch",
    description: "One screen with a single question.",
    category: "OTHER",
    definition: {
      screens: [{ title: "Form", heading: "Hello!", buttonLabel: "Submit", fields: [field("text", "Your name", true)] }],
    },
  },
];

function starter(key) {
  const found = STARTERS.find((s) => s.key === String(key || "").toUpperCase());
  if (!found) return null;
  return { ...found, definition: normalizeDefinition(found.definition).definition };
}

module.exports = {
  CATEGORIES,
  FIELD_TYPES,
  LIMITS,
  STARTERS,
  starter,
  screenId,
  normalizeDefinition,
  buildFlowJson,
  describeAnswers,
  flowJsonVersion,
};
