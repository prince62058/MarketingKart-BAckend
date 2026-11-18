// Ad invoices: the package the customer chose and the same breakdown the app shows on
// "Review & Launch Ad" (Ad Budget, Platform Fee, GST, Payment Gateway, Total Payable).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { adInvoiceLines, legacyAdInvoiceLines, campaignDays } = require("../src/helpers/adInvoice");
const { hasMongod, bootSecurityHarness, fake } = require("./helpers/securityHarness");

const sum = (items) => Math.round(items.reduce((total, item) => total + item.amount, 0) * 100) / 100;

test("a ₹1,499 Lead On WhatsApp package gives exactly the app's price breakdown", () => {
  // The app's Review & Launch Ad for this package: Ad Budget (3 days) ₹1,105, Platform Fee (15%)
  // ₹165.75, GST (18%) ₹198.9, Payment Gateway (2%) ₹29.35, Total Payable ₹1,499.
  const lines = adInvoiceLines({
    adSpend: 1105,
    total: 1499,
    days: 3,
    packageName: "Starter 3 Days",
    adTypeTitle: "Lead On WhatsApp",
  });
  assert.deepEqual(
    lines.items.map((item) => [item.description, item.subDescription, item.amount]),
    [
      ["Starter 3 Days", "Ad Budget (3 days) · Lead On WhatsApp", 1105],
      ["Platform Fee (15%)", "Campaign setup and management by MarketingKart", 165.75],
      ["Payment Gateway (2%)", "Online payment processing", 29.35],
    ],
  );
  assert.equal(lines.packageName, "Starter 3 Days");
  assert.equal(lines.budgetLabel, "Ad Budget (3 days)");
  assert.equal(lines.gstAmount, 198.9);
  assert.equal(lines.gstRate, 18);
  assert.equal(lines.subTotal, 1300.1);
  assert.equal(lines.totalAmount, 1499);
  assert.equal(Math.round((lines.subTotal + lines.gstAmount) * 100) / 100, lines.totalAmount, "the invoice adds up to what was paid");
  assert.equal(sum(lines.items), lines.subTotal);
  assert.ok(lines.items.every((item) => item.qty === 1 && item.unitPrice === item.amount));
});

test("a custom budget, the company's own fee rates, and no charged total", () => {
  const lines = adInvoiceLines({
    adSpend: 1000,
    days: 1,
    fees: { serviceFee: 10, gstFee: 18, paymentGetWayFee: 3 },
  });
  assert.equal(lines.packageName, "Custom Budget");
  assert.equal(lines.items[0].subDescription, "Ad Budget (1 day)");
  assert.equal(lines.items[1].description, "Platform Fee (10%)");
  assert.equal(lines.items[2].description, "Payment Gateway (3%)");
  // Without a charged amount the gateway fee is its rate on the other three lines.
  assert.equal(lines.platformFee, 100);
  assert.equal(lines.gstAmount, 180);
  assert.equal(lines.gatewayFee, 38.4);
  assert.equal(lines.totalAmount, 1318.4);

  const unknownDays = adInvoiceLines({ adSpend: 500, packageName: "  ", fees: { serviceFee: "oops" } });
  assert.equal(unknownDays.items[0].subDescription, "Ad Budget");
  assert.equal(unknownDays.packageName, "Custom Budget");
  assert.equal(unknownDays.items[1].description, "Platform Fee (15%)", "an unreadable rate falls back to the default");
});

test("the gateway fee is never negative and the total is always what was charged", () => {
  const lines = adInvoiceLines({ adSpend: 1105, total: 1400, days: 3, packageName: "Odd" });
  assert.equal(lines.gatewayFee, 0);
  assert.equal(lines.totalAmount, 1400);
});

test("campaign days come from the start and end dates", () => {
  assert.equal(campaignDays("Mon, 16 Nov 2026 00:00:00 GMT", "Thu, 19 Nov 2026 00:00:00 GMT"), 3);
  assert.equal(campaignDays(new Date("2026-11-16T10:00:00Z"), new Date("2026-11-16T22:00:00Z")), 1);
  assert.equal(campaignDays(null, "2026-11-19"), null);
  assert.equal(campaignDays("2026-11-19", "2026-11-16"), null);
});

test("an old ad invoice shows its stored amounts as budget, fees and GST", () => {
  const lines = legacyAdInvoiceLines(
    { adsAmount: 737, commisionAmount: 110.55, gstAmount: "132.66", paymentGetWayFee: "16.95" },
    "Lead On WhatsApp",
  );
  assert.deepEqual(
    lines.items.map((item) => [item.description, item.amount]),
    [["Lead On WhatsApp", 737], ["Platform Fee", 110.55], ["Payment Gateway", 16.95]],
  );
  assert.equal(lines.subTotal, 864.5);
  assert.equal(lines.gstAmount, 132.66);
  assert.equal(lines.totalAmount, 997.16);
  assert.equal(legacyAdInvoiceLines({ adsAmount: 100 }).items[0].description, "Ad Campaign");
});

// ── Against the real app and a throwaway mongod: the invoice saved after an ad payment, its page in the
// admin panel and the app, and the PDF that is e-mailed. No browser and no e-mail leave the test.
const skip = !hasMongod;
const pdfPages = [];
const mails = [];
let failPdf = false;
let h;

before(async () => {
  if (skip) return;
  fake("puppeteer", {
    launch: async () => {
      if (failPdf) throw new Error("no browser in this test");
      return {
        newPage: async () => ({
          setContent: async (html) => {
            pdfPages.push(html);
          },
          pdf: async () => Buffer.from("%PDF-1.4 test"),
        }),
        close: async () => {},
      };
    },
  });
  fake("nodemailer", {
    createTransport: () => ({
      sendMail: async (mail) => {
        mails.push(mail);
        return { messageId: "test" };
      },
    }),
  });
  h = await bootSecurityHarness();
});

after(async () => {
  if (h) await h.close();
});

async function paidAd({ businessEmail } = {}) {
  const fixtures = require("./helpers/securityFixtures");
  const AdType = require("../src/models/advertisementModel");
  const Plan = require("../src/models/planModel");
  const owner = await fixtures.makeUser();
  const business = await fixtures.makeBusiness(owner, { businessName: "Sharma Sweets", ...(businessEmail ? { businessEmail } : {}) });
  const adType = await AdType.create({ title: "Lead On WhatsApp" });
  const plan = await Plan.create({ title: "Starter 3 Days", duretion: 3, price: 1499 });
  const campaign = {
    addTypeId: adType._id,
    businessId: business._id,
    planId: plan._id,
    startDate: "Mon, 16 Nov 2026 00:00:00 GMT",
    endDate: "Thu, 19 Nov 2026 00:00:00 GMT",
  };
  return { owner, business, adType, plan, campaign };
}

test("an ad payment saves an invoice with the package and the app's breakdown, and its page shows them", { skip }, async () => {
  const { generateInvoice } = require("../src/controllers/invoiceController");
  const Invoice = require("../src/models/invoiceModel");
  const { business, plan, campaign } = await paidAd({ businessEmail: "owner@example.com" });

  await generateInvoice([campaign], "pay_test_1", 552.5, 552.5, 0, { adSpend: 1105, total: 1499, planId: plan._id });

  const saved = await Invoice.findOne({ businessId: business._id }).lean();
  assert.ok(saved, "the invoice is saved");
  assert.equal(saved.packageName, "Starter 3 Days");
  assert.equal(String(saved.planId), String(plan._id));
  assert.deepEqual(saved.items.map((item) => [item.description, item.amount]), [
    ["Starter 3 Days", 1105],
    ["Platform Fee (15%)", 165.75],
    ["Payment Gateway (2%)", 29.35],
  ]);
  assert.equal(saved.items[0].subDescription, "Ad Budget (3 days) · Lead On WhatsApp");
  assert.equal(saved.gstAmount, "198.9");
  assert.equal(saved.gstRate, 18);
  assert.equal(saved.subTotal, 1300.1);
  assert.equal(saved.totalAmount, 1499);
  assert.equal(saved.adsAmount, 1105);
  assert.equal(saved.commisionAmount, 165.75);
  assert.equal(saved.paymentGetWayFee, "29.35");

  // The page the admin panel previews and the app opens.
  const page = await h.call("GET", `/api/getInvoiceHTML?invoiceId=${saved._id}`);
  assert.equal(page.status, 200);
  for (const text of ["Starter 3 Days", "Ad Budget (3 days) · Lead On WhatsApp", "Platform Fee (15%)", "Payment Gateway (2%)", "GST (18%)", "1,499"]) {
    assert.ok(page.text.includes(text), `the invoice page shows "${text}"`);
  }
  assert.ok(!page.text.includes("Social Media Marketing Service"));

  // The e-mailed PDF shows the same lines, in the app's order.
  const pdf = pdfPages.at(-1);
  assert.ok(pdf, "a PDF was rendered");
  const order = ["Starter 3 Days", "Ad Budget (3 days):", "Platform Fee (15%):", "GST (18%):", "Payment Gateway (2%):", "Total Paid:"].map((text) => pdf.indexOf(text));
  assert.ok(order.every((at) => at >= 0), "every line is in the PDF");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in the app's order");
  for (const amount of ["₹1105.00", "₹165.75", "₹198.90", "₹29.35", "₹1499.00"]) assert.ok(pdf.includes(amount), amount);
  const mail = mails.at(-1);
  assert.equal(mail.to, "owner@example.com");
  assert.ok(mail.html.includes("Starter 3 Days · Lead On WhatsApp"));
  assert.ok(mail.html.includes("₹1499.00"));
});

test("the invoice is saved even when the PDF cannot be made, and no e-mail goes to a business without one", { skip }, async () => {
  const { generateInvoice } = require("../src/controllers/invoiceController");
  const Invoice = require("../src/models/invoiceModel");
  const { business, campaign } = await paidAd();
  const mailsBefore = mails.length;

  failPdf = true;
  try {
    await generateInvoice([{ ...campaign, planId: null }], "wallet_test_1", 600, 400, 0, { adSpend: 1000, total: 1357 });
  } finally {
    failPdf = false;
  }
  const saved = await Invoice.findOne({ businessId: business._id }).lean();
  assert.ok(saved, "the invoice exists without its PDF");
  assert.equal(saved.packageName, "Custom Budget");
  assert.equal(saved.items[0].description, "Custom Budget");
  assert.equal(saved.totalAmount, 1357);
  assert.equal(mails.length, mailsBefore);
});

test("an old ad invoice without lines shows its budget, fees and GST instead of a generic service", { skip }, async () => {
  const Invoice = require("../src/models/invoiceModel");
  const { owner, business, adType } = await paidAd();
  const old = await Invoice.create({
    adsAmount: 737,
    commisionAmount: 110.55,
    gstAmount: "132.66",
    paymentGetWayFee: "16.95",
    userId: owner._id,
    businessId: business._id,
    adsTypeId: adType._id,
  });
  const page = await h.call("GET", `/api/getInvoiceHTML?invoiceId=${old._id}`);
  assert.equal(page.status, 200);
  for (const text of ["Lead On WhatsApp", "Platform Fee", "Payment Gateway", "864.5", "132.66", "997.16"]) {
    assert.ok(page.text.includes(text), `the old invoice page shows "${text}"`);
  }
  assert.ok(!page.text.includes("Social Media Marketing Service"));
});
