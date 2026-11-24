/** Menu the WhatsApp Marketing account tab is allowed to show. */
const CATALOG = [
  { key: "billing", action: "billing", title: "Billing Details", subtitle: "WhatsApp plan and wallet", sortOrder: 10, hidden: false },
  { key: "orders", action: "orders", title: "Order History", subtitle: "WhatsApp plan payments", sortOrder: 20, hidden: false },
  { key: "invoices", action: "invoices", title: "Invoices", subtitle: "Download WhatsApp bills", sortOrder: 30, hidden: false },
  { key: "plans", action: "plans", title: "Plans", subtitle: "WhatsApp message plans", sortOrder: 40, hidden: false },
  { key: "wallet", action: "wallet", title: "Wallet", subtitle: "WhatsApp Marketing balance", sortOrder: 50, hidden: false },
  { key: "chatbot", action: "chatbot", title: "AI Chatbot", subtitle: "Chatbot plan and replies", sortOrder: 60, hidden: false },
  { key: "templates", action: "templates", title: "Templates", subtitle: "WhatsApp message templates", sortOrder: 70, hidden: true },
  { key: "campaigns", action: "campaigns", title: "Campaigns", subtitle: "Broadcasts you have sent", sortOrder: 80, hidden: true },
  { key: "contacts", action: "contacts", title: "Contacts", subtitle: "People you can message", sortOrder: 90, hidden: true },
  { key: "flows", action: "flows", title: "Flows", subtitle: "WhatsApp forms", sortOrder: 100, hidden: true },
  { key: "support", action: "support", title: "WhatsApp Support", subtitle: "Help with WhatsApp Marketing", sortOrder: 110, hidden: false },
];

const BY_KEY = new Map(CATALOG.map((item) => [item.key, item]));

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeItem(input, fallback) {
  const title = clip(input?.title, 80) || fallback.title;
  const subtitle = clip(input?.subtitle, 140);
  const sortOrder = Number(input?.sortOrder);
  return {
    key: fallback.key,
    action: fallback.action,
    title,
    subtitle: subtitle || fallback.subtitle,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : fallback.sortOrder,
    hidden: input?.hidden === undefined ? Boolean(fallback.hidden) : Boolean(input.hidden),
  };
}

/** Keep only known WhatsApp actions. Admin text replaces the label, not the destination. */
function mergeMenu(saved = [], edits) {
  const savedByKey = new Map(saved.map((item) => [item.key, item]));
  const editByKey = new Map((Array.isArray(edits) ? edits : []).filter((item) => item && BY_KEY.has(item.key)).map((item) => [item.key, item]));
  return CATALOG.map((item) => normalizeItem(editByKey.get(item.key) || savedByKey.get(item.key) || item, item));
}

function visibleMenu(rows) {
  return rows
    .filter((item) => item && !item.hidden && BY_KEY.has(item.key))
    .map((item) => ({
      key: item.key,
      action: BY_KEY.get(item.key).action,
      title: item.title,
      subtitle: item.subtitle,
      sortOrder: item.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

module.exports = { CATALOG, mergeMenu, visibleMenu };
