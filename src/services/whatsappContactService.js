// Contacts, contact groups and custom fields for the WhatsApp customer panel.
// Every query is scoped to the signed-in owner; ids from the client are never trusted on their own.
const mongoose = require("mongoose");
const Contact = require("../models/whatsappContactModel");
const Group = require("../models/whatsappContactGroupModel");
const Field = require("../models/whatsappContactFieldModel");

const SOURCES = ["Direct", "Imported", "Organic", "API", "Lead Gen", "Click-to-WhatsApp", "Link & QR", "HubSpot", "Zoho CRM", "LeadSquared"];
const FIELD_TYPES = ["Text", "Number", "Date", "Email"];
const RESERVED_KEYS = new Set(["name", "phone", "email", "groups", "source", "subscribed", "_id", "id"]);
const MAX_IMPORT = 5000;
const MAX_EXPORT = 20000;
const MAX_AUDIENCE = 50000;

class ContactError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Pure helpers (unit tested) ---------- */

// Same rule as campaign sending: 10 digits are Indian numbers, otherwise keep the country code.
function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

function fieldKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const isId = (value) => mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === String(value);

// Keeps only values for fields the owner defined, as short strings.
function cleanCustom(custom, fields) {
  const allowed = new Set(fields.map((f) => f.key));
  const out = {};
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return out;
  for (const [key, value] of Object.entries(custom)) {
    if (!allowed.has(key) || value === undefined || value === null) continue;
    const text = String(value).trim().slice(0, 500);
    if (text) out[key] = text;
  }
  return out;
}

function buildFilter(userId, { search, group, source, status, from, to } = {}) {
  const filter = { userId };
  const term = String(search || "").trim().slice(0, 80);
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    filter.$or = [{ name: rx }, { phone: rx }];
  }
  if (group && isId(group)) filter.groups = new mongoose.Types.ObjectId(group);
  if (source && SOURCES.includes(source)) filter.source = source;
  if (status === "sub") filter.subscribed = { $ne: false };
  if (status === "unsub") filter.subscribed = false;
  // Date range on when the contact was added; `to` is inclusive of that whole day.
  const start = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const end = to ? new Date(`${to}T23:59:59.999Z`) : null;
  if ((start && !Number.isNaN(start.getTime())) || (end && !Number.isNaN(end.getTime()))) {
    filter.createdAt = {};
    if (start && !Number.isNaN(start.getTime())) filter.createdAt.$gte = start;
    if (end && !Number.isNaN(end.getTime())) filter.createdAt.$lte = end;
  }
  return filter;
}

function present(contact) {
  const obj = contact.toObject ? contact.toObject() : contact;
  return {
    _id: obj._id,
    name: obj.name || "",
    phone: obj.phone,
    groups: (obj.groups || []).map(String),
    source: obj.source || "Direct",
    subscribed: obj.subscribed !== false,
    custom: obj.custom || {},
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

/* ---------- Ownership helpers ---------- */

async function ownedGroupIds(userId, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(isId);
  if (!list.length) return [];
  const rows = await Group.find({ userId, _id: { $in: list } }).select("_id").lean();
  return rows.map((r) => r._id);
}

async function fieldsOf(userId) {
  return Field.find({ userId }).sort({ createdAt: 1 }).lean();
}

/* ---------- Contacts ---------- */

async function listContacts(userId, query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
  const filter = buildFilter(userId, query);
  const [rows, total] = await Promise.all([
    Contact.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Contact.countDocuments(filter),
  ]);
  return { data: rows.map(present), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

async function exportContacts(userId, query = {}) {
  const rows = await Contact.find(buildFilter(userId, query)).sort({ createdAt: -1 }).limit(MAX_EXPORT).lean();
  return rows.map(present);
}

async function createContact(userId, body = {}) {
  const phone = normalizePhone(body.phone);
  if (!phone) throw new ContactError(400, "Enter the phone number with country code, e.g. 919876543210.");
  const [groups, fields] = await Promise.all([ownedGroupIds(userId, body.groups), fieldsOf(userId)]);
  try {
    const contact = await Contact.create({
      userId,
      phone,
      name: String(body.name || "").trim().slice(0, 120),
      groups,
      source: SOURCES.includes(body.source) ? body.source : "Direct",
      subscribed: body.subscribed !== false,
      custom: cleanCustom(body.custom, fields),
    });
    return present(contact);
  } catch (error) {
    if (error?.code === 11000) throw new ContactError(409, `${phone} is already in your contacts.`);
    throw error;
  }
}

async function updateContact(userId, id, body = {}) {
  if (!isId(id)) throw new ContactError(404, "Contact not found");
  const set = {};
  if (body.name !== undefined) set.name = String(body.name || "").trim().slice(0, 120);
  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone);
    if (!phone) throw new ContactError(400, "Enter the phone number with country code, e.g. 919876543210.");
    set.phone = phone;
  }
  if (body.groups !== undefined) set.groups = await ownedGroupIds(userId, body.groups);
  if (body.subscribed !== undefined) set.subscribed = body.subscribed !== false;
  if (body.custom !== undefined) set.custom = cleanCustom(body.custom, await fieldsOf(userId));
  try {
    const contact = await Contact.findOneAndUpdate({ _id: id, userId }, { $set: set }, { new: true });
    if (!contact) throw new ContactError(404, "Contact not found");
    return present(contact);
  } catch (error) {
    if (error?.code === 11000) throw new ContactError(409, `${set.phone} is already in your contacts.`);
    throw error;
  }
}

async function deleteContact(userId, id) {
  if (!isId(id)) throw new ContactError(404, "Contact not found");
  const result = await Contact.deleteOne({ _id: id, userId });
  if (!result.deletedCount) throw new ContactError(404, "Contact not found");
  return { deleted: 1 };
}

async function bulkContacts(userId, { ids, action, groupId } = {}) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(isId).slice(0, 5000);
  if (!list.length) throw new ContactError(400, "Select at least one contact.");
  const match = { userId, _id: { $in: list } };
  if (action === "delete") {
    const r = await Contact.deleteMany(match);
    return { changed: r.deletedCount };
  }
  if (action === "subscribe" || action === "unsubscribe") {
    const r = await Contact.updateMany(match, { $set: { subscribed: action === "subscribe" } });
    return { changed: r.modifiedCount };
  }
  if (action === "addGroup" || action === "removeGroup") {
    const [group] = await ownedGroupIds(userId, [groupId]);
    if (!group) throw new ContactError(404, "Group not found");
    const update = action === "addGroup" ? { $addToSet: { groups: group } } : { $pull: { groups: group } };
    const r = await Contact.updateMany(match, update);
    return { changed: r.modifiedCount };
  }
  throw new ContactError(400, "Unknown action");
}

// Adds new numbers, skips numbers already saved (and repeats inside the file), counts invalid rows.
async function importContacts(userId, { contacts, groupId, source } = {}) {
  if (!Array.isArray(contacts) || !contacts.length) throw new ContactError(400, "No contacts to import.");
  if (contacts.length > MAX_IMPORT) throw new ContactError(413, `Import at most ${MAX_IMPORT} contacts at a time.`);
  const [groups, fields] = await Promise.all([groupId ? ownedGroupIds(userId, [groupId]) : [], fieldsOf(userId)]);
  if (groupId && !groups.length) throw new ContactError(404, "Group not found");
  const origin = SOURCES.includes(source) ? source : "Imported";
  // Rows may also name their own groups (used when moving contacts saved in the browser).
  const rowGroupIds = [...new Set(contacts.flatMap((row) => (Array.isArray(row?.groups) ? row.groups.map(String) : [])))];
  const owned = new Set((await ownedGroupIds(userId, rowGroupIds)).map(String));

  let invalid = 0;
  const byPhone = new Map();
  for (const row of contacts) {
    const phone = normalizePhone(row?.phone);
    if (!phone) { invalid += 1; continue; }
    if (byPhone.has(phone)) continue;
    byPhone.set(phone, {
      userId,
      phone,
      name: String(row?.name || "").trim().slice(0, 120),
      groups: [...new Set([...groups.map(String), ...(Array.isArray(row?.groups) ? row.groups.map(String).filter((g) => owned.has(g)) : [])])],
      source: SOURCES.includes(row?.source) ? row.source : origin,
      subscribed: row?.subscribed !== false,
      custom: cleanCustom(row?.custom, fields),
    });
  }
  const phones = [...byPhone.keys()];
  const existing = new Set((await Contact.find({ userId, phone: { $in: phones } }).select("phone").lean()).map((c) => c.phone));
  const fresh = phones.filter((p) => !existing.has(p)).map((p) => byPhone.get(p));

  let added = 0;
  if (fresh.length) {
    try {
      const made = await Contact.insertMany(fresh, { ordered: false });
      added = made.length;
    } catch (error) {
      // A concurrent import can race us on the unique index; count what did go in.
      if (error?.code !== 11000 && !error?.writeErrors) throw error;
      added = error.insertedDocs?.length ?? error.result?.nInserted ?? 0;
    }
  }
  if (groups.length && existing.size) {
    await Contact.updateMany({ userId, phone: { $in: [...existing] } }, { $addToSet: { groups: groups[0] } });
  }
  return { added, skipped: contacts.length - invalid - added, invalid };
}

// Subscribed contacts in any of the groups, one per phone, shaped for POST /whatsapp/campaigns.
async function audience(userId, { groups } = {}) {
  const ids = await ownedGroupIds(userId, groups);
  if (!ids.length) return [];
  const rows = await Contact.find({ userId, groups: { $in: ids }, subscribed: { $ne: false } })
    .select("name phone custom")
    .limit(MAX_AUDIENCE)
    .lean();
  return rows.map((c) => ({ ...(c.custom || {}), phone: c.phone, name: c.name || "" }));
}

/* ---------- Groups ---------- */

function cleanKeywords(keywords) {
  return [...new Set((Array.isArray(keywords) ? keywords : []).map((k) => String(k).trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
}

async function listGroups(userId) {
  const [groups, counts] = await Promise.all([
    Group.find({ userId }).sort({ createdAt: -1 }).lean(),
    Contact.aggregate([{ $match: { userId: new mongoose.Types.ObjectId(String(userId)) } }, { $unwind: "$groups" }, { $group: { _id: "$groups", count: { $sum: 1 } } }]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));
  return groups.map((g) => ({ ...g, contactCount: byId.get(String(g._id)) || 0 }));
}

async function saveGroup(userId, id, body = {}) {
  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) throw new ContactError(400, "Enter a group name.");
  const doc = { name, keywords: cleanKeywords(body.keywords) };
  try {
    if (!id) return (await Group.create({ userId, ...doc })).toObject();
    if (!isId(id)) throw new ContactError(404, "Group not found");
    const group = await Group.findOneAndUpdate({ _id: id, userId }, { $set: doc }, { new: true }).lean();
    if (!group) throw new ContactError(404, "Group not found");
    return group;
  } catch (error) {
    if (error?.code === 11000) throw new ContactError(409, `You already have a group called “${name}”.`);
    throw error;
  }
}

// Deletes the group; contacts stay unless `withContacts` is set.
async function deleteGroup(userId, id, { withContacts = false } = {}) {
  if (!isId(id)) throw new ContactError(404, "Group not found");
  const group = await Group.findOneAndDelete({ _id: id, userId });
  if (!group) throw new ContactError(404, "Group not found");
  let removedContacts = 0;
  if (withContacts) removedContacts = (await Contact.deleteMany({ userId, groups: group._id })).deletedCount;
  else await Contact.updateMany({ userId, groups: group._id }, { $pull: { groups: group._id } });
  return { deleted: 1, removedContacts };
}

/* ---------- Custom fields ---------- */

async function listFields(userId) {
  return fieldsOf(userId);
}

async function createField(userId, body = {}) {
  const name = String(body.name || "").trim().slice(0, 60);
  const key = fieldKey(body.key || name);
  if (!name || !key) throw new ContactError(400, "Enter a field name.");
  if (RESERVED_KEYS.has(key)) throw new ContactError(409, `“${key}” is a built-in field.`);
  try {
    return (await Field.create({ userId, name, key, type: FIELD_TYPES.includes(body.type) ? body.type : "Text" })).toObject();
  } catch (error) {
    if (error?.code === 11000) throw new ContactError(409, `You already have a field called “${key}”.`);
    throw error;
  }
}

async function deleteField(userId, id) {
  if (!isId(id)) throw new ContactError(404, "Field not found");
  const field = await Field.findOneAndDelete({ _id: id, userId });
  if (!field) throw new ContactError(404, "Field not found");
  await Contact.updateMany({ userId }, { $unset: { [`custom.${field.key}`]: "" } });
  return { deleted: 1 };
}

module.exports = {
  ContactError,
  SOURCES,
  MAX_IMPORT,
  normalizePhone,
  fieldKey,
  cleanCustom,
  buildFilter,
  listContacts,
  exportContacts,
  createContact,
  updateContact,
  deleteContact,
  bulkContacts,
  importContacts,
  audience,
  listGroups,
  saveGroup,
  deleteGroup,
  listFields,
  createField,
  deleteField,
};
