// The words printed on the MarketingKart invoice today. A template starts as this page.
// Customer name, line items and amounts are never part of a template.
const STOCK = Object.freeze({
  tagline: "Smart Marketing\nStronger Business\nwith AI",
  thankYouHeading: "Thank You!",
  thankYouText: "for choosing MarketingKart.ai",
  bankName: "HDFC Bank",
  accountName: "Ayotrix Infotech Pvt Ltd",
  accountNumber: "502000XXXXXXXX",
  ifscCode: "HDFC0001234",
  upiId: "ayotrix@hdfcbank",
  notes: "Please make the payment within the due date.\nThis is a computer generated invoice and does not require a physical signature.\nFor any queries, feel free to contact us.",
  signatoryFor: "For MarketingKart.ai",
  signatoryName: "Dkumar",
  signatoryLabel: "Authorized Signatory",
  brandParent: "Ayotrix Infotech Pvt Ltd",
  brandSubtext: "IDEAS | TECHNOLOGY | GROWTH",
  brandPhone: "+91 98765 43210",
  brandEmail: "info@ayotrix.com",
  brandWebsite: "www.ayotrix.com",
  brandCity: "Indore, Madhya Pradesh, India",
  brandMotto: "Let's Build\na Smarter\nTomorrow",
  bottomServicesBar: "Social Media Marketing | Google Ads | Meta Ads | WhatsApp Marketing | AI Solutions | Lead Management",
  paymentTerms: "Net 15 Days",
  brandKicker: "LEADS | AUTOMATE | GROW",
  poweredByLabel: "Powered by",
  billToTitle: "Bill To",
  invoiceTitle: "INVOICE",
  serviceLabel: "",
  invoiceNoLabel: "Invoice No",
  invoiceDateLabel: "Invoice Date",
  dueDateLabel: "Due Date",
  statusLabel: "Status",
  paymentTermsLabel: "Payment Terms",
  paidViaLabel: "Paid via",
  paymentIdLabel: "Payment ID",
  paidOnLabel: "Paid on",
  paidWord: "Paid",
  colHash: "#",
  colDescription: "Description",
  colQty: "Qty",
  colPrice: "Unit Price (INR)",
  colAmount: "Amount (INR)",
  subtotalLabel: "Subtotal",
  gstLabel: "GST",
  totalLabel: "Total Amount (INR)",
  paymentTitle: "Payment Details",
  paymentStatusTitle: "Payment status",
  paidTitle: "Payment",
  notesTitle: "Notes",
  signatoryTitle: "Authorized Signatory",
  bankNameLabel: "Bank Name",
  accountNameLabel: "Account Name",
  accountNumberLabel: "Account No.",
  ifscLabel: "IFSC Code",
  upiLabel: "UPI ID",
  brandOfLabel: "A Brand of",
  paidNotes: "This invoice is paid in full.\nThis is a computer generated invoice and does not require a physical signature.\nFor any queries, feel free to contact us.",
  companyGstLabel: "GST No",
  companyGstin: "",
  customerGstLabel: "GST No",
});

const KEYS = Object.freeze(Object.keys(STOCK));

const norm = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function isStock(key, value) {
  return norm(value) === norm(STOCK[key]);
}

function dummyPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return !digits || digits.endsWith("9876543210");
}

function placeholderBank(accountNumber, ifscCode) {
  return /x{3,}/i.test(String(accountNumber || "")) || /0001234/.test(String(ifscCode || ""));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Invoice text wins only when an admin typed something of their own on that bill.
// Otherwise the selected template is what prints, so editing a template updates every bill that uses it.
function pickChrome(invoice, template, company) {
  const chosen = {};
  for (const key of KEYS) {
    const custom = invoice?.[key];
    const fromTemplate = template?.[key];
    const base = fromTemplate != null && String(fromTemplate).trim() !== "" ? fromTemplate : STOCK[key];
    const customized = custom != null && String(custom).trim() !== "" && norm(custom) !== norm(base) && !isStock(key, custom);
    chosen[key] = customized ? custom : base;
  }
  const ownPhone = invoice?.brandPhone;
  const phoneIsCustom = ownPhone && !dummyPhone(ownPhone) && !isStock("brandPhone", ownPhone) && norm(ownPhone) !== norm(template?.brandPhone);
  if (phoneIsCustom) chosen.brandPhone = ownPhone;
  else if (!dummyPhone(template?.brandPhone)) chosen.brandPhone = template.brandPhone;
  else if (!dummyPhone(company?.phone)) chosen.brandPhone = company.phone;
  else chosen.brandPhone = "";
  return chosen;
}

function chromeFromBody(body) {
  const out = {};
  if (!body || typeof body !== "object") return out;
  for (const key of KEYS) {
    if (body[key] !== undefined) out[key] = String(body[key] ?? "").slice(0, 2000);
  }
  return out;
}

module.exports = {
  STOCK,
  KEYS,
  isStock,
  dummyPhone,
  placeholderBank,
  escapeHtml,
  pickChrome,
  chromeFromBody,
};
