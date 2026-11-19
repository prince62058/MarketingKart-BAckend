// Every invoice is drawn in the colours of the service it bills, taken from that service's screens in
// the app. The MarketingKart logo stays the same on all of them.
const THEMES = Object.freeze({
  META_ADS: { label: "Meta Ads", primary: "#F97316", dark: "#EA580C", soft: "#FFF7ED", border: "#FDBA74", line: "#FED7AA" },
  WHATSAPP: { label: "WhatsApp Marketing", primary: "#16A34A", dark: "#15803D", soft: "#F0FDF4", border: "#86EFAC", line: "#BBF7D0" },
  AI_VIDEO: { label: "AI Video", primary: "#C026D3", dark: "#A21CAF", soft: "#FDF4FF", border: "#F0ABFC", line: "#F5D0FE" },
  RCS: { label: "RCS Marketing", primary: "#1877F2", dark: "#1464D0", soft: "#E7F3FF", border: "#93C5FD", line: "#D6E6FB" },
});

const SERVICES = Object.freeze(Object.keys(THEMES));

/** The service an invoice bills. Invoices saved before this field existed were all for Meta ads. */
function invoiceService(invoice) {
  const service = String(invoice?.service || "").toUpperCase();
  return THEMES[service] ? service : "META_ADS";
}

const invoiceTheme = (invoice) => THEMES[invoiceService(invoice)];

module.exports = { THEMES, SERVICES, invoiceService, invoiceTheme };
