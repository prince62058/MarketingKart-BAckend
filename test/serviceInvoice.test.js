const { test } = require("node:test");
const assert = require("node:assert/strict");
const { whatsappPlanInvoice, nextInvoiceNumber } = require("../src/services/serviceInvoiceService");

function query(result) {
  const q = {
    select() { return q; },
    sort() { return q; },
    lean: async () => result,
  };
  return q;
}

function fakes() {
  const created = [];
  const updates = [];
  const Invoices = {
    created,
    updates,
    countDocuments: async () => created.length,
    findOne(filter = {}) {
      if (filter.transactionId) {
        return query(created.find((row) => row.transactionId === filter.transactionId) || null);
      }
      const numbered = created.filter((row) => row.invoiceNumber).map((row) => row.invoiceNumber).sort();
      return query(numbered.length ? { invoiceNumber: numbered[numbered.length - 1] } : null);
    },
    async create(doc) {
      const saved = { ...doc, _id: `inv-${created.length + 1}` };
      created.push(saved);
      return saved;
    },
    async updateOne(filter, update) {
      updates.push([filter, update]);
      const row = created.find((item) => item._id === filter._id);
      if (row && update.$set) Object.assign(row, update.$set);
    },
  };
  const Companies = { findOne: () => query({ invoicePrefix: "MKAI" }) };
  const Businesses = { findOne: () => query({ _id: "biz-1" }) };
  return { created, updates, deps: { Invoice: Invoices, Company: Companies, Business: Businesses } };
}

test("invoice numbers keep increasing after an unnumbered invoice exists", async () => {
  const { deps, created } = fakes();
  created.push({ invoiceNumber: null });
  assert.equal(await nextInvoiceNumber(deps.Invoice, deps.Company), `MKAI/${new Date().getFullYear()}/0002`);
  created.push({ invoiceNumber: `MKAI/${new Date().getFullYear()}/0002` });
  assert.equal(await nextInvoiceNumber(deps.Invoice, deps.Company), `MKAI/${new Date().getFullYear()}/0003`);
});

test("a WhatsApp plan invoice bills the wallet debit once and adds no GST", async () => {
  const { deps, created, updates } = fakes();
  const paidAt = new Date("2026-11-15T09:44:39.194Z");
  const first = await whatsappPlanInvoice({
    userId: "user-1",
    planTitle: "Enterprise Plan",
    amount: 1999,
    days: 30,
    transactionId: "txn-1",
    paidAt,
  }, deps);
  assert.equal(first.totalAmount, 1999);
  assert.equal(first.gstAmount, "0");
  assert.equal(first.gstRate, 0);
  assert.equal(first.packageName, "Enterprise Plan");
  assert.equal(first.paymentMethod, "MarketingKart WhatsApp wallet");
  assert.equal(first.invoiceNumber, `MKAI/${new Date().getFullYear()}/0001`);
  assert.equal(updates.length, 1);
  assert.equal(created[0].createdAt.toISOString(), paidAt.toISOString());
  const second = await whatsappPlanInvoice({
    userId: "user-1",
    planTitle: "Enterprise Plan",
    amount: 1999,
    transactionId: "txn-1",
  }, deps);
  assert.equal(second._id, first._id);
  assert.equal(created.length, 1);
  assert.equal(await whatsappPlanInvoice({ userId: "user-1", planTitle: "Free", amount: 0, transactionId: "txn-0" }, deps), null);
});
