// Signed, expiring links to an invoice page, so the page can open in a browser without a login
// token while an invoice id alone is not enough to read it.
const crypto = require("crypto");

const DAYS = 10;

function secret() {
  return process.env.INVOICE_LINK_SECRET || process.env.JWT_SECRET || process.env.TOKEN_KEY || "";
}

function sign(invoiceId, exp) {
  return crypto.createHmac("sha256", secret()).update(`${invoiceId}.${exp}`).digest("base64url");
}

function invoiceLinkParams(invoiceId) {
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
  return `invoiceId=${encodeURIComponent(String(invoiceId))}&exp=${exp}&sig=${sign(String(invoiceId), exp)}`;
}

/** "valid" | "missing" | "invalid" */
function checkInvoiceLink(invoiceId, exp, sig) {
  if (!sig || !exp) return "missing";
  if (!secret() || !/^\d+$/.test(String(exp)) || Number(exp) < Date.now() / 1000) return "invalid";
  const expected = Buffer.from(sign(String(invoiceId), Number(exp)));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? "valid" : "invalid";
}

module.exports = { invoiceLinkParams, checkInvoiceLink };
