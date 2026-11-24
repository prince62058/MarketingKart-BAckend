/** Menu the WhatsApp Marketing account tab is allowed to show. */
const CATALOG = [
  { key: "billing", action: "billing", title: "Wallet billing", subtitle: "Message plan and wallet", sortOrder: 10, hidden: false },
  { key: "chatbot-billing", action: "chatbot-billing", title: "Chatbot billing", subtitle: "Chatbot plan and AI replies", sortOrder: 15, hidden: false },
  { key: "orders", action: "orders", title: "Wallet orders", subtitle: "Message plan and wallet payments", sortOrder: 20, hidden: false },
  { key: "invoices", action: "invoices", title: "Wallet invoices", subtitle: "Message plan and wallet bills", sortOrder: 30, hidden: false },
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

/** Labels shipped before wallet and chatbot bills were split. A custom admin label is left as-is. */
const PREVIOUS_LABEL = {
  billing: { title: "Billing Details", subtitle: "WhatsApp plan and wallet" },
  orders: { title: "Order History", subtitle: "WhatsApp plan payments" },
  invoices: { title: "Invoices", subtitle: "Download WhatsApp bills" },
};

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

function refreshPreviousLabel(saved, fallback) {
  if (!saved) return undefined;
  const previous = PREVIOUS_LABEL[fallback.key];
  if (!previous) return saved;
  const title = clip(saved.title, 80);
  const subtitle = clip(saved.subtitle, 140);
  if (title !== previous.title && subtitle !== previous.subtitle) return saved;
  return {
    ...saved,
    title: title === previous.title ? fallback.title : saved.title,
    subtitle: subtitle === previous.subtitle ? fallback.subtitle : saved.subtitle,
  };
}

/** Keep only known WhatsApp actions. Admin text replaces the label, not the destination. */
function mergeMenu(saved = [], edits) {
  const savedByKey = new Map(saved.map((item) => [item.key, item]));
  const editByKey = new Map((Array.isArray(edits) ? edits : []).filter((item) => item && BY_KEY.has(item.key)).map((item) => [item.key, item]));
  return CATALOG.map((item) => normalizeItem(
    editByKey.get(item.key) || refreshPreviousLabel(savedByKey.get(item.key), item) || item,
    item,
  ));
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
