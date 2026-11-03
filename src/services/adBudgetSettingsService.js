const AdBudgetSettings = require("../models/adBudgetSettingsModel");

// What the app used before these were editable. 89 is Meta's floor per day for these campaigns.
const DEFAULTS = Object.freeze({
  customEnabled: true,
  minBudget: 1500,
  maxBudget: 1000000,
  defaultBudget: 1500,
  budgetPresets: [1500, 2000, 3000, 5000, 10000],
  defaultDuration: 4,
  maxDuration: 60,
  durationPresets: [1, 3, 5, 7, 14, 30],
  minDailySpend: 89,
});

const FIELDS = Object.keys(DEFAULTS);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const rupees = n => `₹${Number(n).toLocaleString("en-IN")}`;

function wholeNumber(value, label, min, max) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw httpError(400, `${label} must be a whole number from ${min.toLocaleString("en-IN")} to ${max.toLocaleString("en-IN")}.`);
  }
  return n;
}

function wholeNumberList(value, label, min, max, maxItems) {
  if (!Array.isArray(value) || value.length === 0) throw httpError(400, `${label} needs at least one value.`);
  if (value.length > maxItems) throw httpError(400, `${label} can have at most ${maxItems} values.`);
  const numbers = value.map(item => wholeNumber(item, `Each value in ${label}`, min, max));
  if (new Set(numbers).size !== numbers.length) throw httpError(400, `${label} has the same value twice.`);
  return numbers.sort((a, b) => a - b);
}

// Stored fields laid over the defaults; a field the admin never saved keeps its default.
function merge(stored) {
  const result = { ...DEFAULTS, budgetPresets: [...DEFAULTS.budgetPresets], durationPresets: [...DEFAULTS.durationPresets] };
  if (!stored) return result;
  for (const field of FIELDS) {
    const value = stored[field];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) result[field] = [...value];
    } else {
      result[field] = value;
    }
  }
  return result;
}

/**
 * Checks a full set of rules (what the admin form sends) and returns them clean. Every rule is
 * checked against the others, so the app can never open on a budget it would then refuse.
 */
function validate(input) {
  if (!input || typeof input !== "object") throw httpError(400, "Send the custom budget rules.");
  if (typeof input.customEnabled !== "boolean") throw httpError(400, "Say whether the Custom Budget tab is on or off.");

  const minDailySpend = wholeNumber(input.minDailySpend, "Minimum spend per day", 1, 10000);
  const minBudget = wholeNumber(input.minBudget, "Minimum budget", 100, 10000000);
  const maxBudget = wholeNumber(input.maxBudget, "Maximum budget", 100, 100000000);
  if (maxBudget < minBudget) throw httpError(400, "The maximum budget cannot be lower than the minimum budget.");
  const defaultBudget = wholeNumber(input.defaultBudget, "Starting budget", minBudget, maxBudget);
  const budgetPresets = wholeNumberList(input.budgetPresets, "Budget buttons", minBudget, maxBudget, 8);

  const maxDuration = wholeNumber(input.maxDuration, "Longest campaign", 1, 365);
  const defaultDuration = wholeNumber(input.defaultDuration, "Starting duration", 1, maxDuration);
  const durationPresets = wholeNumberList(input.durationPresets, "Duration buttons", 1, maxDuration, 8);

  // The screen opens on defaultBudget over defaultDuration; that must already meet the daily floor.
  if (defaultBudget / defaultDuration < minDailySpend) {
    throw httpError(
      400,
      `${rupees(defaultBudget)} over ${defaultDuration} day(s) is ${rupees(Math.round(defaultBudget / defaultDuration))} a day, below the minimum of ${rupees(minDailySpend)} a day. Raise the starting budget or shorten the starting duration.`,
    );
  }

  return { customEnabled: input.customEnabled, minBudget, maxBudget, defaultBudget, budgetPresets, defaultDuration, maxDuration, durationPresets, minDailySpend };
}

async function get() {
  return merge(await AdBudgetSettings.findOne({ key: "global" }).lean());
}

async function update(input, admin) {
  const clean = validate(input);
  const saved = await AdBudgetSettings.findOneAndUpdate(
    { key: "global" },
    { $set: { ...clean, updatedBy: (admin && (admin.name || admin.email)) || "admin" } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return merge(saved);
}

module.exports = { DEFAULTS, merge, validate, get, update };
