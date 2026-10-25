// Works out AI Video prices from what HeyGen charges us, so every sale keeps a chosen profit.
// Nothing here touches a database or the network: it only prints numbers. Re-run it when HeyGen's
// price or the dollar rate changes, then enter the result on the admin panel's AI Video > Settings page.
//
//   node src/scripts/aiVideoPricing.js
//   node src/scripts/aiVideoPricing.js --usd-inr 94 --markup 0.35 --video-seconds 45
//   node src/scripts/aiVideoPricing.js --no-gst        (prices that do not include GST)
//   node src/scripts/aiVideoPricing.js --json          (only the settings, ready to paste/PUT)
//
// Model: 1 credit = 1 second of avatar video. A video costs a fixed number of credits (the length it
// may run to), so a short video earns more than the target and a full-length one earns exactly it.
//
// Measured on 2026-10-17: one 10.19 s 1080p Avatar IV render cost $0.40 of HeyGen wallet
// (wallet $10.00 -> $9.60). That is the default below; third-party sources quote other rates, so
// re-measure before relying on it (read the wallet via GET /api/admin/ai-video/health before/after one render).

const DEFAULTS = {
  costPerSecondUsd: 0.0393,
  usdInr: 96.5,
  markup: 0.3, // profit over cost, after GST and the payment fee
  videoSeconds: 30, // longest video one "video price" covers
  priceIncludesGst: true, // customers pay the listed price, GST is inside it
  gstRate: 0.18,
  gatewayFeeRate: 0.0236, // Razorpay 2% + 18% GST on the fee, of the amount charged
  roundTo: 0.5, // rupees; the price per credit is rounded UP to this
  packCredits: [100, 500, 1200],
  planCredits: { pro: 300, business: 1000 },
  yearlyDiscount: 0, // any discount lowers the profit; see the report
  voiceoverCredits: 8, // not measured yet: HeyGen's speech price per second is unknown
  maxScriptChars: 400, // ~24 s of speech, so a slow 0.8x voice still stays inside videoSeconds
};

const ceilTo = (value, step) => Math.ceil(value / step - 1e-9) * step;
const round2 = value => Math.round(value * 100) / 100;
const pct = value => `${round2(value * 100)}%`;

function computePricing(input = {}) {
  const o = { ...DEFAULTS, ...input, planCredits: { ...DEFAULTS.planCredits, ...(input.planCredits || {}) } };
  const costPerCredit = o.costPerSecondUsd * o.usdInr; // 1 credit = 1 second
  // Of each rupee a customer pays, this much is ours after GST (if it is included) and the gateway fee.
  const netFactor = (o.priceIncludesGst ? 1 / (1 + o.gstRate) : 1) - o.gatewayFeeRate;
  const pricePerCredit = ceilTo((costPerCredit * (1 + o.markup)) / netFactor, o.roundTo);
  // What we keep over cost, after GST and the gateway fee, when `credits` are sold for `price`.
  const profit = (price, credits) => (price * netFactor) / (credits * costPerCredit) - 1;

  const videoCost = Math.round(o.videoSeconds);
  const packs = o.packCredits.map(credits => ({ id: `pack_${credits}`, credits, price: Math.round(credits * pricePerCredit), active: true }));
  const names = { pro: "Pro", business: "Business" };
  const plans = [{ id: "free", name: "Free", price: 0, yearlyPrice: 0, monthlyCredits: videoCost, active: true }];
  for (const [id, credits] of Object.entries(o.planCredits)) {
    const price = Math.round(credits * pricePerCredit);
    plans.push({ id, name: names[id] || id, price, yearlyPrice: Math.round(price * 12 * (1 - o.yearlyDiscount)), monthlyCredits: credits, active: true });
  }

  const settings = {
    videoCost,
    voiceoverCost: o.voiceoverCredits,
    freeCredits: videoCost, // one free video, which costs us about as much as the profit on 4 sales
    maxScriptChars: o.maxScriptChars,
    packs,
    plans,
  };

  const report = {
    assumptions: { costPerSecondUsd: o.costPerSecondUsd, usdInr: o.usdInr, markup: o.markup, priceIncludesGst: o.priceIncludesGst, gatewayFeeRate: o.gatewayFeeRate },
    costPerCreditInr: round2(costPerCredit),
    pricePerCreditInr: pricePerCredit,
    video: { credits: videoCost, ourCostInr: round2(videoCost * costPerCredit), customerPaysInr: videoCost * pricePerCredit, profitOverCost: round2(profit(videoCost * pricePerCredit, videoCost)) },
    packs: packs.map(p => ({ id: p.id, price: p.price, profitOverCost: round2(profit(p.price, p.credits)) })),
    plans: plans.filter(p => p.price).map(p => ({
      id: p.id,
      monthly: { price: p.price, profitOverCost: round2(profit(p.price, p.monthlyCredits)) },
      yearly: { price: p.yearlyPrice, profitOverCost: round2(profit(p.yearlyPrice, p.monthlyCredits * 12)) },
    })),
    freeVideoCostInr: round2(videoCost * costPerCredit),
  };
  return { settings, report };
}

function main(argv) {
  const args = {};
  const flags = new Set(argv.filter(a => a.startsWith("--")).map(a => a.slice(2)));
  argv.forEach((a, i) => {
    if (a.startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) args[a.slice(2)] = Number(argv[i + 1]);
  });
  const { settings, report } = computePricing({
    ...(args["cost-per-second-usd"] ? { costPerSecondUsd: args["cost-per-second-usd"] } : {}),
    ...(args["usd-inr"] ? { usdInr: args["usd-inr"] } : {}),
    ...(args.markup ? { markup: args.markup } : {}),
    ...(args["video-seconds"] ? { videoSeconds: args["video-seconds"] } : {}),
    ...(args["yearly-discount"] ? { yearlyDiscount: args["yearly-discount"] } : {}),
    ...(flags.has("no-gst") ? { priceIncludesGst: false } : {}),
  });
  if (flags.has("json")) return console.log(JSON.stringify(settings, null, 2));

  const { video } = report;
  console.log(`1 credit = 1 second of video. Our cost: Rs ${report.costPerCreditInr} per credit. Selling price: Rs ${report.pricePerCreditInr} per credit.`);
  console.log(`One video (up to ${video.credits} s) = ${video.credits} credits: costs us Rs ${video.ourCostInr}, customer pays Rs ${video.customerPaysInr}, profit over cost ${pct(video.profitOverCost)}.`);
  console.log("\nPacks:  " + settings.packs.map(p => `${p.credits} credits Rs ${p.price}`).join("  |  "));
  for (const p of settings.plans.filter(x => x.price)) {
    console.log(`Plan ${p.name}: ${p.monthlyCredits} credits/month Rs ${p.price}/month, Rs ${p.yearlyPrice}/year`);
  }
  console.log(`New users get ${settings.freeCredits} free credits (one free video, about Rs ${report.freeVideoCostInr} of cost). Script limit ${settings.maxScriptChars} characters.`);
  console.log("\nSettings to enter on the admin panel (or send with PUT /api/admin/ai-video/settings):");
  console.log(JSON.stringify(settings, null, 2));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { computePricing, DEFAULTS };
