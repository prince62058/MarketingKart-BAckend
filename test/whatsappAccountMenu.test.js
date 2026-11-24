const { test } = require("node:test");
const assert = require("node:assert/strict");
const { CATALOG, mergeMenu, visibleMenu } = require("../src/services/whatsappAccountMenu");

test("the app menu keeps only WhatsApp actions and hides the ones the admin turned off", () => {
  const rows = mergeMenu([], [
    { key: "billing", title: "  My billing  ", subtitle: "Wallet", sortOrder: 2, hidden: false },
    { key: "logout", title: "Logout", hidden: false },
    { key: "plans", title: "", subtitle: "", hidden: false },
    { key: "templates", title: "Message templates", subtitle: "Approved templates", sortOrder: 1, hidden: false },
  ]);
  const visible = visibleMenu(rows);
  assert.equal(visible.some((item) => item.action === "logout"), false);
  assert.equal(visible.find((item) => item.key === "billing").title, "My billing");
  assert.equal(visible.find((item) => item.key === "plans").title, "Plans");
  assert.equal(visible[0].key, "templates");
  assert.equal(visible.some((item) => item.key === "campaigns"), false);
  assert.equal(rows.length, CATALOG.length);
});

test("a saved label stays when the admin does not send a new one", () => {
  const rows = mergeMenu([{ key: "wallet", title: "Message wallet", subtitle: "Balance", sortOrder: 4, hidden: false }]);
  assert.equal(rows.find((item) => item.key === "wallet").title, "Message wallet");
  assert.equal(rows.find((item) => item.key === "support").hidden, false);
});
