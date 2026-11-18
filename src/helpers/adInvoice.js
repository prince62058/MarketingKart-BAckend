// The lines of an ad invoice: the package the customer chose, then the same breakdown the app shows
// on "Review & Launch Ad" (Ad Budget, Platform Fee, GST, Payment Gateway). Pure, so it is tested on
// its own and shared by the e-mailed PDF and the invoice page (admin preview and the app's invoices).

const DEFAULT_FEES = { serviceFee: 15, gstFee: 18, paymentGetWayFee: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const percent = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const PLATFORM_NOTE = "Campaign setup and management by MarketingKart";
const GATEWAY_NOTE = "Online payment processing";

/** Whole days a campaign runs (at least 1), or null when the dates are missing or out of order. */
function campaignDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(1, Math.round((end - start) / DAY_MS));
}

/**
 * adSpend: the Meta budget in rupees. total: what the customer was actually charged; when it is given,
 * the gateway fee is what is left after the other three lines, exactly as the app works it out, so the
 * invoice always adds up to the amount paid. fees: the company settings (serviceFee, gstFee,
 * paymentGetWayFee, in percent). packageName: the chosen package's title; none means a custom budget.
 */
function adInvoiceLines({ adSpend, total, days, packageName, adTypeTitle, fees } = {}) {
  const platformPercent = percent(fees?.serviceFee, DEFAULT_FEES.serviceFee);
  const gstPercent = percent(fees?.gstFee, DEFAULT_FEES.gstFee);
  const gatewayPercent = percent(fees?.paymentGetWayFee, DEFAULT_FEES.paymentGetWayFee);

  const spend = round2(adSpend);
  const platformFee = round2((spend * platformPercent) / 100);
  const gst = round2((spend * gstPercent) / 100);
  const beforeGateway = round2(spend + platformFee + gst);
  const charged = Number(total);
  const paid = Number.isFinite(charged) && charged > 0;
  const gatewayFee = paid
    ? Math.max(0, round2(charged - beforeGateway))
    : round2((beforeGateway * gatewayPercent) / 100);
  const totalAmount = paid ? round2(charged) : round2(beforeGateway + gatewayFee);

  const name = String(packageName || "").trim() || "Custom Budget";
  const dayCount = Number(days);
  const budgetLabel =
    Number.isFinite(dayCount) && dayCount > 0
      ? `Ad Budget (${dayCount} ${dayCount === 1 ? "day" : "days"})`
      : "Ad Budget";
  const type = String(adTypeTitle || "").trim();

  return {
    packageName: name,
    budgetLabel,
    adSpend: spend,
    platformFee,
    gstAmount: gst,
    gatewayFee,
    gstRate: gstPercent,
    subTotal: round2(spend + platformFee + gatewayFee),
    totalAmount,
    items: [
      {
        description: name,
        subDescription: type ? `${budgetLabel} · ${type}` : budgetLabel,
        qty: 1,
        unitPrice: spend,
        amount: spend,
      },
      {
        description: `Platform Fee (${platformPercent}%)`,
        subDescription: PLATFORM_NOTE,
        qty: 1,
        unitPrice: platformFee,
        amount: platformFee,
      },
      {
        description: `Payment Gateway (${gatewayPercent}%)`,
        subDescription: GATEWAY_NOTE,
        qty: 1,
        unitPrice: gatewayFee,
        amount: gatewayFee,
      },
    ],
  };
}

/**
 * Lines for an ad invoice saved before invoices kept their own lines: only the amounts are stored
 * (adsAmount, commisionAmount, paymentGetWayFee, gstAmount), not the package or the fee rates.
 */
function legacyAdInvoiceLines(invoice, adTypeTitle) {
  const spend = round2(invoice?.adsAmount);
  const platformFee = round2(invoice?.commisionAmount);
  const gatewayFee = round2(parseFloat(invoice?.paymentGetWayFee));
  const gst = round2(parseFloat(invoice?.gstAmount));
  const type = String(adTypeTitle || "").trim();
  return {
    subTotal: round2(spend + platformFee + gatewayFee),
    gstAmount: gst,
    totalAmount: round2(spend + platformFee + gatewayFee + gst),
    items: [
      { description: type || "Ad Campaign", subDescription: "Ad Budget", qty: 1, unitPrice: spend, amount: spend },
      { description: "Platform Fee", subDescription: PLATFORM_NOTE, qty: 1, unitPrice: platformFee, amount: platformFee },
      { description: "Payment Gateway", subDescription: GATEWAY_NOTE, qty: 1, unitPrice: gatewayFee, amount: gatewayFee },
    ],
  };
}

module.exports = { adInvoiceLines, legacyAdInvoiceLines, campaignDays, DEFAULT_FEES };
