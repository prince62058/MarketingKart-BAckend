const fs = require("fs");
const path = require("path");

// The artwork is used exactly as supplied (black lockup, wordmark included).
const ayotrixLogoB64 =
  "data:image/png;base64," +
  fs.readFileSync(path.join(__dirname, "../assets/ayotrix-infotech-logo.png")).toString("base64");

/**
 * Last line of every invoice. The MarketingKart mark stays in the header;
 * this sits under the invoice, after every other footer.
 * The label is dark (not white-on-black CSS) so it still prints when the
 * browser or PDF engine skips background graphics. The logo's own black
 * field is part of the image, so it always prints.
 */
function poweredByBlock() {
  return `<div class="ayotrix-powered"><div class="ayotrix-powered-label">Powered by</div><img src="${ayotrixLogoB64}" alt="Ayotrix Infotech" /></div>`;
}

const poweredByCss = `
.ayotrix-powered {
  margin-top: 14px;
  text-align: center;
  page-break-inside: avoid;
  break-inside: avoid;
}
.ayotrix-powered-label {
  color: #64748b;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: 6px;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
.ayotrix-powered img {
  height: 112px;
  width: auto;
  display: inline-block;
}
`;

module.exports = { ayotrixLogoB64, poweredByBlock, poweredByCss };
