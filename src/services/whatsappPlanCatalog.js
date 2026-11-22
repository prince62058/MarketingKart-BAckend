// India Meta rates, rupees × 10,000, so the plan check never uses a float.
// Marketing ₹0.8631, Utility ₹0.115, Authentication ₹0.115, Service ₹0.115.
const META_POINTS = {
  marketingCredits: 8631,
  utilityCredits: 1150,
  authenticationCredits: 1150,
  serviceCredits: 1150,
};

// A plan has to keep this much of its price after Meta is paid for every included message.
const MIN_MARGIN = 0.2;
// A year paid in advance is 5% off. That is the largest cut that still clears Meta on Enterprise.
const ANNUAL_PAY_FACTOR = 0.95;

const CYCLES = {
  MONTHLY: { months: 1, days: 30, payFactor: 1 },
  QUARTERLY: { months: 3, days: 90, payFactor: 1 },
  ANNUAL: { months: 12, days: 365, payFactor: ANNUAL_PAY_FACTOR },
};

const CATALOG = [
  {
    code: "starter",
    title: "Starter",
    price: 999,
    duration: 30,
    contactLimit: 5000,
    campaignLimit: 50,
    templateLimit: 10,
    marketingCredits: 500,
    utilityCredits: 1000,
    authenticationCredits: 500,
    serviceCredits: 0,
    features: [
      "500 marketing messages — photo, video or file",
      "1,000 utility messages — text only",
      "500 OTP messages",
      "Up to 5,000 contacts and 1 WhatsApp number",
      "After the included messages, the wallet pays only for messages Meta delivers",
    ],
    badge: "START HERE",
    color: "#059669",
    sortOrder: 1,
  },
  {
    code: "growth",
    title: "Growth",
    price: 2499,
    duration: 30,
    contactLimit: 20000,
    campaignLimit: 200,
    templateLimit: 25,
    marketingCredits: 1500,
    utilityCredits: 3000,
    authenticationCredits: 1500,
    serviceCredits: 0,
    features: [
      "1,500 marketing messages — photo, video or file",
      "3,000 utility messages — text only",
      "1,500 OTP messages",
      "Up to 20,000 contacts, 2 numbers and 3 team seats",
      "After the included messages, the wallet pays only for messages Meta delivers",
    ],
    badge: "MOST POPULAR",
    color: "#10B981",
    sortOrder: 2,
  },
  {
    code: "business",
    title: "Business",
    price: 4999,
    duration: 30,
    contactLimit: 50000,
    campaignLimit: 500,
    templateLimit: 50,
    marketingCredits: 3000,
    utilityCredits: 7000,
    authenticationCredits: 3000,
    serviceCredits: 0,
    features: [
      "3,000 marketing messages — photo, video or file",
      "7,000 utility messages — text only",
      "3,000 OTP messages",
      "Up to 50,000 contacts, 5 numbers and 10 team seats",
      "After the included messages, the wallet pays only for messages Meta delivers",
    ],
    badge: "BEST VALUE",
    color: "#314fb2",
    sortOrder: 3,
  },
  {
    code: "enterprise",
    title: "Enterprise",
    price: 9999,
    duration: 30,
    contactLimit: 100000,
    campaignLimit: 2000,
    templateLimit: 100,
    marketingCredits: 6000,
    utilityCredits: 15000,
    authenticationCredits: 8000,
    serviceCredits: 0,
    features: [
      "6,000 marketing messages — photo, video or file",
      "15,000 utility messages — text only",
      "8,000 OTP messages",
      "Up to 1,00,000 contacts, 10 numbers and 25 team seats",
      "After the included messages, the wallet pays only for messages Meta delivers",
    ],
    badge: "MAXIMUM SCALE",
    color: "#0F172A",
    sortOrder: 4,
  },
];

function whole(value) {
  const n = Math.floor(Number(value) || 0);
  return n > 0 ? n : 0;
}

function metaCostPaise(plan) {
  const points = Object.entries(META_POINTS).reduce(
    (sum, [field, rate]) => sum + whole(plan[field]) * rate,
    0
  );
  return Math.round(points / 100);
}

function assertPlanEarns(plan) {
  const pricePaise = Math.round(Number(plan.price) * 100);
  if (!Number.isFinite(pricePaise) || pricePaise < 100) {
    throw new Error("A WhatsApp plan needs a price of at least ₹1.");
  }
  const costPaise = metaCostPaise(plan);
  const margin = (pricePaise - costPaise) / pricePaise;
  if (margin < MIN_MARGIN) {
    const keep = ((pricePaise - costPaise) / 100).toFixed(2);
    throw new Error(
      `This plan keeps ₹${keep} after Meta's cost of the included messages. Raise the price or lower the credits so at least 20% remains.`
    );
  }
}

function normalizeCycle(cycle) {
  const key = String(cycle || "MONTHLY").toUpperCase();
  return CYCLES[key] ? key : "MONTHLY";
}

function cycleQuote(plan, cycle) {
  assertPlanEarns(plan);
  const key = normalizeCycle(cycle);
  const spec = CYCLES[key];
  const total = Math.round(Number(plan.price) * spec.months * spec.payFactor);
  const costPaise = metaCostPaise(plan) * spec.months;
  if (total * 100 <= costPaise) {
    throw new Error("That billing period is below Meta's cost. Use a monthly plan.");
  }
  return {
    cycle: key,
    months: spec.months,
    days: spec.days,
    total,
    credits: {
      marketingCredits: whole(plan.marketingCredits) * spec.months,
      utilityCredits: whole(plan.utilityCredits) * spec.months,
      authenticationCredits: whole(plan.authenticationCredits) * spec.months,
      serviceCredits: whole(plan.serviceCredits) * spec.months,
    },
  };
}

module.exports = {
  META_POINTS,
  MIN_MARGIN,
  ANNUAL_PAY_FACTOR,
  CATALOG,
  metaCostPaise,
  assertPlanEarns,
  normalizeCycle,
  cycleQuote,
};
