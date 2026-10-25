const { test } = require("node:test");
const assert = require("node:assert/strict");

// The settings validator pulls in the logger; keep it from writing log files during the test.
const loggerFile = require.resolve("../src/utils/logger");
require.cache[loggerFile] = { id: loggerFile, filename: loggerFile, loaded: true, exports: { info() {}, warn() {}, error() {}, debug() {} } };
const { computePricing } = require("../src/scripts/aiVideoPricing");
const { validatePatch } = require("../src/modules/aiVideo/aiVideo.settings");

test("default prices: Rs 6 per credit (GST included), 30 credits per video, 30% kept after GST and the Razorpay fee", () => {
  const { settings, report } = computePricing();
  assert.equal(report.pricePerCreditInr, 6);
  assert.equal(settings.videoCost, 30);
  assert.deepEqual(settings.packs.map(p => [p.credits, p.price]), [[100, 600], [500, 3000], [1200, 7200]]);
  const pro = settings.plans.find(p => p.id === "pro");
  assert.deepEqual([pro.monthlyCredits, pro.price, pro.yearlyPrice], [300, 1800, 21600]);
  assert.equal(settings.freeCredits, 30);
  assert.ok(report.video.profitOverCost >= 0.3, `profit ${report.video.profitOverCost}`);
});

test("every pack, plan and video keeps at least the chosen profit, whatever the inputs", () => {
  for (const input of [{}, { priceIncludesGst: false }, { usdInr: 88 }, { usdInr: 105, markup: 0.5 }, { costPerSecondUsd: 0.06 }, { videoSeconds: 45 }, { roundTo: 1 }]) {
    const { report } = computePricing(input);
    const target = input.markup ?? 0.3;
    const sales = [report.video.profitOverCost, ...report.packs.map(p => p.profitOverCost), ...report.plans.flatMap(p => [p.monthly.profitOverCost, p.yearly.profitOverCost])];
    for (const profit of sales) assert.ok(profit >= target - 0.005, `${JSON.stringify(input)}: ${profit} < ${target}`);
  }
});

test("a yearly discount costs profit: 50% off a year loses money, so the calculator reports it", () => {
  const { report } = computePricing({ yearlyDiscount: 0.5 });
  for (const plan of report.plans) assert.ok(plan.yearly.profitOverCost < 0, `${plan.id} ${plan.yearly.profitOverCost}`);
});

test("prices follow the dollar rate and HeyGen's price", () => {
  const base = computePricing().report.pricePerCreditInr;
  assert.ok(computePricing({ usdInr: 110 }).report.pricePerCreditInr > base);
  assert.ok(computePricing({ costPerSecondUsd: 0.02 }).report.pricePerCreditInr < base);
});

test("the settings it produces are accepted by the admin settings validator", () => {
  for (const input of [{}, { priceIncludesGst: false }, { videoSeconds: 20, markup: 0.4 }]) {
    const patch = validatePatch(computePricing(input).settings);
    assert.equal(patch.packs.length, 3);
    assert.ok(patch.plans.some(p => p.id === "free"), "the free plan is kept");
    assert.ok(patch.videoCost >= 1);
  }
});
