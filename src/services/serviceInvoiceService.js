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
  const prefix = company?.invoicePrefix || "MKAI";
  const year = new Date().getFullYear();
  const head = `${prefix}/${year}/`;
  const latest = await Invoices.findOne({ invoiceNumber: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${year}/\\d+$`) })
    .sort({ invoiceNumber: -1 })
    .select("invoiceNumber")
    .lean();
  const seq = parseInt(String(latest?.invoiceNumber || "").split("/").pop(), 10);
  const count = await Invoices.countDocuments();
  const next = Math.max(Number.isFinite(seq) ? seq : 0, count) + 1;
  return `${head}${String(next).padStart(4, "0")}`;
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
  const transactionId = String(paymentId || order.razorpayPaymentId || order.id || "");
  if (transactionId) {
    const existing = await Invoices.findOne({ transactionId, service: "AI_VIDEO" }).lean();
    if (existing) return existing;
  }
  return Invoices.create({
    service: "AI_VIDEO",
    status: "PAID",
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
    transactionId,
  });
}

/**
 * A WhatsApp message plan or chatbot plan paid from the WhatsApp wallet.
 * The invoice total is the amount that left the wallet. GST is not added on top,
 * because the wallet debit is the whole charge. The same transaction is never billed twice.
 */
async function whatsappPlanInvoice({ userId, planTitle, amount, days, replies, transactionId, planId, paidAt }, deps = {}) {
  const total = round2(amount);
  const paymentRef = String(transactionId || "");
  if (!(total > 0) || !paymentRef) return null;
  const Invoices = deps.Invoice || Invoice;
  const existing = await Invoices.findOne({ transactionId: paymentRef }).lean();
  if (existing) return existing;
  const dayCount = Number(days);
  const replyCount = Number(replies);
  const detail = [
    Number.isFinite(dayCount) && dayCount > 0 ? `${dayCount} days` : null,
    Number.isFinite(replyCount) && replyCount > 0 ? `${replyCount.toLocaleString("en-IN")} AI replies` : null,
    "Paid from the WhatsApp wallet",
  ].filter(Boolean).join(" · ");
  const title = String(planTitle || "WhatsApp plan").trim() || "WhatsApp plan";
  const saved = await Invoices.create({
    service: "WHATSAPP",
    invoiceNumber: await nextInvoiceNumber(Invoices, deps.Company || Company),
    userId,
    businessId: await businessOf(deps.Business || Business, userId, null),
    packageName: title,
    planId: planId || undefined,
    items: [{ description: title, subDescription: detail, qty: 1, unitPrice: total, amount: total }],
    subTotal: total,
    gstAmount: "0",
    gstRate: 0,
    totalAmount: total,
    paymentMethod: "MarketingKart WhatsApp wallet",
    transactionId: paymentRef,
    status: "PAID",
  });
  // createdAt is immutable on the schema, so a normal update cannot move a backfilled bill
  // back to the day the wallet was actually charged.
  if (paidAt && saved?._id) {
    const when = new Date(paidAt);
    if (typeof Invoices.collection?.updateOne === "function") {
      await Invoices.collection.updateOne({ _id: saved._id }, { $set: { createdAt: when } });
    } else {
      await Invoices.updateOne({ _id: saved._id }, { $set: { createdAt: when } });
    }
    saved.createdAt = when;
  }
  return saved;
}

module.exports = { whatsappRechargeInvoice, aiVideoOrderInvoice, whatsappPlanInvoice, nextInvoiceNumber, AI_VIDEO_GST_RATE };
