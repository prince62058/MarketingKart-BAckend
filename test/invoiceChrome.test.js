const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STOCK, pickChrome, escapeHtml } = require("../src/helpers/invoiceChrome");

test("a template change prints on bills that still have the original wording", () => {
  const template = { ...STOCK, tagline: "Ads that bring customers", bankName: "Axis Bank", billToTitle: "Billed to" };
  const invoice = { tagline: STOCK.tagline, bankName: STOCK.bankName, thankYouHeading: STOCK.thankYouHeading, billToTitle: STOCK.billToTitle };
  const chrome = pickChrome(invoice, template, {});
  assert.equal(chrome.tagline, "Ads that bring customers");
  assert.equal(chrome.bankName, "Axis Bank");
  assert.equal(chrome.thankYouHeading, "Thank You!");
  assert.equal(chrome.billToTitle, "Billed to");
});

test("wording typed on one bill stays on that bill", () => {
  const template = { ...STOCK, notes: "Pay by transfer." };
  const invoice = { notes: "This campaign was billed to the Indore office." };
  const chrome = pickChrome(invoice, template, {});
  assert.equal(chrome.notes, "This campaign was billed to the Indore office.");
  assert.equal(pickChrome({ notes: "Pay by transfer." }, template, {}).notes, "Pay by transfer.");
});

test("the placeholder phone never prints, and a real company phone does", () => {
  const chrome = pickChrome({ brandPhone: STOCK.brandPhone }, { ...STOCK, brandPhone: "" }, { phone: "+91 9111155016" });
  assert.equal(chrome.brandPhone, "+91 9111155016");
  const own = pickChrome({ brandPhone: "+91 6205872519" }, STOCK, { phone: "+91 9111155016" });
  assert.equal(own.brandPhone, "+91 6205872519");
});

test("customer text cannot break the invoice page", () => {
  assert.equal(escapeHtml(`A & B <script>`), "A &amp; B &lt;script&gt;");
});
