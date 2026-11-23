// One AI reply costs us about ₹0.185 in the worst case: ₹0.07 OpenAI plus ₹0.115 WhatsApp.
// Kept as paise × 10 so the margin check never uses a float.
const REPLY_COST_PAISE_X10 = 185;
const MIN_MARGIN = 0.2;
const EXTRA_REPLY_RUPEES = 0.8;

const PLANS = [
  {
    code: "chatbot_start",
    title: "Chatbot Start",
    price: 499,
    duration: 30,
    replyCredits: 1000,
    features: [
      "1,000 AI replies in 30 days",
      "A greeting or a request for a human is not counted",
      "After the included replies, each extra AI reply is ₹0.80 from the WhatsApp wallet",
    ],
    badge: "START HERE",
    color: "#059669",
    sortOrder: 1,
  },
  {
    code: "chatbot_growth",
    title: "Chatbot Growth",
    price: 1499,
    duration: 30,
    replyCredits: 5000,
    features: [
      "5,000 AI replies in 30 days",
      "A greeting or a request for a human is not counted",
      "After the included replies, each extra AI reply is ₹0.80 from the WhatsApp wallet",
    ],
    badge: "MOST POPULAR",
    color: "#10B981",
    sortOrder: 2,
  },
  {
    code: "chatbot_scale",
    title: "Chatbot Scale",
    price: 3499,
    duration: 30,
    replyCredits: 15000,
    features: [
      "15,000 AI replies in 30 days",
      "A greeting or a request for a human is not counted",
      "After the included replies, each extra AI reply is ₹0.80 from the WhatsApp wallet",
    ],
    badge: "BEST VALUE",
    color: "#314fb2",
    sortOrder: 3,
  },
];

function assertPlanEarns(plan) {
  const pricePaise = Math.round(Number(plan.price) * 100);
  const replies = Math.floor(Number(plan.replyCredits) || 0);
  if (!Number.isFinite(pricePaise) || pricePaise < 100) {
    throw new Error("A chatbot plan needs a price of at least ₹1.");
  }
  if (replies < 1) throw new Error("A chatbot plan needs at least one included reply.");
  const costPaise = Math.round((replies * REPLY_COST_PAISE_X10) / 10);
  const margin = (pricePaise - costPaise) / pricePaise;
  if (margin < MIN_MARGIN) {
    const keep = ((pricePaise - costPaise) / 100).toFixed(2);
    throw new Error(
      `This chatbot plan keeps ₹${keep} after OpenAI and WhatsApp. Raise the price or lower the replies so at least 20% remains.`
    );
  }
}

PLANS.forEach(assertPlanEarns);

module.exports = {
  PLANS,
  EXTRA_REPLY_RUPEES,
  assertPlanEarns,
};
