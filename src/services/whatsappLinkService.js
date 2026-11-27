// Link & QR links, chat labels, and what happens when a customer's message matches them:
// a link's message → the customer joins its group and the chat gets its labels;
// a label keyword → the chat gets that label; a group keyword → the customer joins that group.
const mongoose = require("mongoose");
const Label = require("../models/whatsappLabelModel");
const Link = require("../models/whatsappLinkModel");
const Group = require("../models/whatsappContactGroupModel");
const Contact = require("../models/whatsappContactModel");
const Account = require("../models/whatsappAccountModel");
const Conversation = require("../models/whatsappConversationModel");
const businessModel = require("../models/businessModel");
const { normalizePhone } = require("./whatsappContactService");

class LinkError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || "")) && /^[a-f0-9]{24}$/i.test(String(v));

/** Lower case, single spaces, no surrounding punctuation noise — how a message is compared. */
function matchKey(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function cleanKeywords(list) {
  const out = [];
  for (const k of Array.isArray(list) ? list : []) {
    const v = String(k || "").trim().toLowerCase().slice(0, 40);
    if (v && !out.includes(v)) out.push(v);
  }
  if (out.length > 20) throw new LinkError(400, "Use at most 20 keywords.");
  return out;
}

/** True when the keyword appears as whole word(s) in the message. */
function hasKeyword(text, keyword) {
  const k = String(keyword || "").trim().toLowerCase();
  if (!k) return false;
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(String(text || ""));
}

/* ---------- Labels ---------- */
async function listLabels(userId) {
  return Label.find({ userId }).sort({ createdAt: 1 }).lean();
}

function cleanLabel(body = {}) {
  const name = String(body.name || "").trim();
  if (!name) throw new LinkError(400, "Give the label a name.");
  if (name.length > 40) throw new LinkError(400, "A label name can be at most 40 characters.");
  const color = /^#[0-9a-f]{6}$/i.test(String(body.color || "")) ? body.color : "#00a884";
  return { name, color, keywords: cleanKeywords(body.keywords) };
}

async function createLabel(userId, body) {
  try {
    return (await Label.create({ userId, ...cleanLabel(body) })).toObject();
  } catch (e) {
    if (e.code === 11000) throw new LinkError(409, "A label with this name already exists.");
    throw e;
  }
}

async function updateLabel(userId, labelId, body) {
  if (!isId(labelId)) throw new LinkError(404, "Label not found.");
  try {
    const label = await Label.findOneAndUpdate({ _id: labelId, userId }, { $set: cleanLabel(body) }, { new: true }).lean();
    if (!label) throw new LinkError(404, "Label not found.");
    return label;
  } catch (e) {
    if (e.code === 11000) throw new LinkError(409, "A label with this name already exists.");
    throw e;
  }
}

async function deleteLabel(userId, labelId) {
  if (!isId(labelId)) throw new LinkError(404, "Label not found.");
  const label = await Label.findOneAndDelete({ _id: labelId, userId });
  if (!label) throw new LinkError(404, "Label not found.");
  const businesses = (await businessModel.find({ userId }).select("_id")).map((b) => b._id);
  await Conversation.updateMany({ businessId: { $in: businesses }, labels: label._id }, { $pull: { labels: label._id } });
  await Link.updateMany({ userId, labelIds: label._id }, { $pull: { labelIds: label._id } });
  return { deleted: true };
}

async function ownLabelIds(userId, ids) {
  const list = (Array.isArray(ids) ? ids : []).filter(isId);
  if (!list.length) return [];
  const found = await Label.find({ userId, _id: { $in: list } }).select("_id").lean();
  return found.map((l) => l._id);
}

/** Replace the labels on one of the user's chats. */
async function setConversationLabels(userId, conversationId, labelIds) {
  if (!isId(conversationId)) throw new LinkError(404, "Chat not found.");
  const businesses = (await businessModel.find({ userId }).select("_id")).map((b) => b._id);
  const labels = await ownLabelIds(userId, labelIds);
  const conversation = await Conversation.findOneAndUpdate(
    { _id: conversationId, businessId: { $in: businesses } },
    { $set: { labels } },
    { new: true }
  ).select("labels").lean();
  if (!conversation) throw new LinkError(404, "Chat not found.");
  return { _id: conversation._id, labels: conversation.labels || [] };
}

/* ---------- Links ---------- */
async function waLink(userId, text) {
  const account = await Account.findOne({ userId, status: "CONNECTED" }).select("phoneNumber").lean();
  const digits = String(account?.phoneNumber || "").replace(/\D/g, "");
  if (!digits) throw new LinkError(409, "Connect your WhatsApp number first.");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

async function cleanLink(userId, body = {}) {
  const text = String(body.text || "").trim();
  if (text.length > 1000) throw new LinkError(400, "The message can be at most 1000 characters.");
  let groupId = null;
  if (body.groupId) {
    if (!isId(body.groupId) || !(await Group.exists({ _id: body.groupId, userId }))) throw new LinkError(400, "Choose one of your contact groups.");
    groupId = body.groupId;
  }
  const labelIds = await ownLabelIds(userId, body.labelIds);
  if ((groupId || labelIds.length) && !text) throw new LinkError(400, "Add a message so customers from this link can be recognised.");
  return { text, match: matchKey(text), groupId, labelIds, link: await waLink(userId, text) };
}

async function listLinks(userId) {
  return Link.find({ userId }).sort({ createdAt: -1 }).limit(500).lean();
}

async function createLink(userId, body) {
  return (await Link.create({ userId, ...(await cleanLink(userId, body)) })).toObject();
}

async function updateLink(userId, linkId, body) {
  if (!isId(linkId)) throw new LinkError(404, "Link not found.");
  const link = await Link.findOneAndUpdate({ _id: linkId, userId }, { $set: await cleanLink(userId, body) }, { new: true }).lean();
  if (!link) throw new LinkError(404, "Link not found.");
  return link;
}

async function deleteLink(userId, linkId) {
  if (!isId(linkId)) throw new LinkError(404, "Link not found.");
  const r = await Link.deleteOne({ _id: linkId, userId });
  if (!r.deletedCount) throw new LinkError(404, "Link not found.");
  return { deleted: true };
}

/* ---------- Inbound ---------- */
/**
 * Called for every new text message a customer sends. Never throws.
 * Returns what it did: { link, groups, labels } (ids), for logs and tests.
 */
async function applyInbound({ userId, conversation, customerPhone, customerName, text }) {
  const done = { link: null, groups: [], labels: [] };
  try {
    if (!userId || !conversation?._id || !text) return done;
    const key = matchKey(text);
    const [link, labels, groups] = await Promise.all([
      key ? Link.findOne({ userId, match: key }).sort({ createdAt: -1 }).lean() : null,
      Label.find({ userId, "keywords.0": { $exists: true } }).select("keywords").lean(),
      Group.find({ userId, "keywords.0": { $exists: true } }).select("keywords").lean(),
    ]);
    const labelIds = new Set((link?.labelIds || []).map(String));
    labels.filter((l) => l.keywords.some((k) => hasKeyword(text, k))).forEach((l) => labelIds.add(String(l._id)));
    const groupIds = new Set(link?.groupId ? [String(link.groupId)] : []);
    groups.filter((g) => g.keywords.some((k) => hasKeyword(text, k))).forEach((g) => groupIds.add(String(g._id)));

    if (labelIds.size) {
      await Conversation.updateOne({ _id: conversation._id }, { $addToSet: { labels: { $each: [...labelIds] } } });
      done.labels = [...labelIds];
    }
    const phone = normalizePhone(customerPhone);
    if (groupIds.size && phone) {
      const name = customerName && customerName !== "Unknown" ? String(customerName).slice(0, 120) : "";
      await Contact.updateOne(
        { userId, phone },
        { $addToSet: { groups: { $each: [...groupIds] } }, $setOnInsert: { name, source: link ? "Link & QR" : "Organic", subscribed: true, custom: {} } },
        { upsert: true }
      );
      done.groups = [...groupIds];
    }
    if (link) {
      await Link.updateOne({ _id: link._id }, { $inc: { joins: 1 }, $set: { lastJoinAt: new Date() } });
      done.link = String(link._id);
    }
  } catch (err) {
    console.error("[Link & QR] inbound match failed:", err.message);
  }
  return done;
}

module.exports = {
  LinkError, matchKey, hasKeyword, cleanKeywords,
  listLabels, createLabel, updateLabel, deleteLabel, setConversationLabels,
  listLinks, createLink, updateLink, deleteLink, applyInbound,
};
