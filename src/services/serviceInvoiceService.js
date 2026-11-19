// Invoices for the services other than Meta ads (those come from invoiceController.generateInvoice):
// a WhatsApp wallet recharge and an AI Video credit pack or plan. Each one lists exactly what was
// charged, and the invoice page draws it in that service's colours (helpers/invoiceThemes.js).
const Invoice = require("../models/invoiceModel");
const Business = require("../models/businessModel");
const Company = require("../models/commpanyModelV2");

const OBJECT_ID = /^[a-f0-9]{24}$/i;
// AI Video prices include GST: the price list was set GST-inclusive (owner, 2026-10-25).
const AI_VIDEO_GST_RATE = 18;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rupees = (n) => `₹${round2(n).toLocaleString("en-IN")}`;
const capitalise = (text) => String(text || "").replace(/^\w/, (c) => c.toUpperCase());

// Numbered like the invoices an admin creates. The app's invoice list shows the number, and without
// one it would call a WhatsApp or AI Video invoice an "Ad Campaign Invoice".
async function nextInvoiceNumber(Invoices, Companies) {
  const company = await Companies.findOne().select("invoicePrefix").lean();
  const count = await Invoices.countDocuments();
  return `${company?.invoicePrefix || "MKAI"}/${new Date().getFullYear()}/${String(count + 1).padStart(4, "0")}`;
}

// The app lists invoices per business, so attach the customer's business when we know it.
async function businessOf(Businesses, userId, businessId) {
  if (businessId && OBJECT_ID.test(String(businessId))) return String(businessId);
  if (!userId) return undefined;
  const business = await Businesses.findOne({ userId }).select("_id").lean();
  return business?._id;
}

/**
 * A WhatsApp wallet recharge paid through Razorpay. Nothing is added on top of a recharge: the whole
 * amount paid goes into the WhatsApp wallet, so the invoice shows that amount and no GST line.
 */
async function whatsappRechargeInvoice({ userId, amount, paymentId, orderId, previousBalance, newBalance }, deps = {}) {
  const Invoices = deps.Invoice || Invoice;
  const Businesses = deps.Business || Business;
  const total = round2(amount);
  const balance =
    Number.isFinite(Number(previousBalance)) && Number.isFinite(Number(newBalance))
      ? ` · wallet ${rupees(previousBalance)} → ${rupees(newBalance)}`
      : "";
  return Invoices.create({
    service: "WHATSAPP",
    invoiceNumber: await nextInvoiceNumber(Invoices, deps.Company || Company),
    userId,
    businessId: await businessOf(Businesses, userId, null),
    items: [
      {
        description: "WhatsApp Wallet Recharge",
        subDescription: `Added to your WhatsApp wallet for messages and plans${balance}`,
        qty: 1,
        unitPrice: total,
        amount: total,
      },
    ],
    subTotal: total,
    gstAmount: "0",
    gstRate: 0,
    totalAmount: total,
    paymentMethod: orderId ? `Razorpay · order ${orderId}` : "Razorpay",
    transactionId: paymentId ? String(paymentId) : undefined,
  });
}

/** An AI Video credit pack or plan, paid online or from the MarketingKart wallet. The price includes GST. */
async function aiVideoOrderInvoice({ userId, businessId, order, paymentId, methodLabel }, deps = {}) {
  const Invoices = deps.Invoice || Invoice;
  const Businesses = deps.Business || Business;
  const price = round2(order.price);
  const taxable = round2(price / (1 + AI_VIDEO_GST_RATE / 100));
  const gst = round2(price - taxable);
  const credits = Number(order.credits) || 0;
  const isPlan = order.kind === "plan";
  const description = isPlan
    ? `AI Video ${capitalise(order.itemId)} Plan (${order.billing || "monthly"})`
    : `${credits.toLocaleString("en-IN")} AI Video Credits`;
  const detail = isPlan
    ? `${credits.toLocaleString("en-IN")} credits · ${Number(order.termDays) || 0} days`
    : `Credit pack · ${credits.toLocaleString("en-IN")} credits`;
  const label = methodLabel || order.methodLabel;
  return Invoices.create({
    service: "AI_VIDEO",
    invoiceNumber: await nextInvoiceNumber(Invoices, deps.Company || Company),
    userId,
    businessId: await businessOf(Businesses, userId, businessId),
    packageName: description,
    items: [
      {
        description,
        subDescription: `${detail} · price ${rupees(price)} includes ${AI_VIDEO_GST_RATE}% GST`,
        qty: 1,
        unitPrice: taxable,
        amount: taxable,
      },
    ],
    subTotal: taxable,
    gstAmount: String(gst),
    gstRate: AI_VIDEO_GST_RATE,
    gstInclusive: true,
    totalAmount: price,
    paymentMethod:
      order.method === "wallet" ? "MarketingKart wallet" : `Razorpay${label && label !== "Wallet" ? ` · ${label}` : ""}`,
    transactionId: String(paymentId || order.razorpayPaymentId || order.id || ""),
  });
}

module.exports = { whatsappRechargeInvoice, aiVideoOrderInvoice, AI_VIDEO_GST_RATE };
