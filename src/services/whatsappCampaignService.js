const mongoose = require("mongoose");
const XLSX = require("xlsx");
const whatsappCampaignModel = require("../models/whatsappCampaignModel");
const whatsappMessageModel = require("../models/whatsappMessageModel");
const whatsappQueue = require("../queues/whatsappQueue");

const buildOwnedQuery = ({ createdBy, isAdmin = false, businessId } = {}) => {
  const query = {};
  if (businessId) {
    query.businessId = mongoose.Types.ObjectId.isValid(businessId)
      ? new mongoose.Types.ObjectId(businessId)
      : businessId;
  }
  if (createdBy && !isAdmin) {
    query.createdBy = mongoose.Types.ObjectId.isValid(createdBy)
      ? new mongoose.Types.ObjectId(createdBy)
      : createdBy;
  }
  return query;
};

/**
 * Normalize phone to E.164 format (add 91 if missing country code).
 */
const normalizePhone = (raw) => {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length > 10) return digits;
  return null;
};

/**
 * Parse an Excel/CSV buffer and return array of contact objects.
 * Expected columns: phone (required), name, email, and any extra fields.
 */
const parseContactsExcel = (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const contacts = [];
  const errors = [];

  rows.forEach((row, idx) => {
    // Support both "phone" and "Phone" column headers
    const rawPhone =
      row.phone || row.Phone || row.PHONE || row.mobile || row.Mobile || "";
    const phone = normalizePhone(rawPhone);

    if (!phone) {
      errors.push(`Row ${idx + 2}: Invalid phone "${rawPhone}"`);
      return;
    }

    contacts.push({
      phone,
      name: String(row.name || row.Name || row.NAME || "").trim(),
      email: String(row.email || row.Email || row.EMAIL || "").trim(),
      // Preserve all extra fields for variable mapping
      ...row,
    });
  });

  return { contacts, errors };
};

/**
 * Parse a simple array of phone numbers and return array of contact objects.
 */
const parsePhoneNumbers = (phoneNumbers) => {
  const contacts = [];
  const errors = [];

  const list = typeof phoneNumbers === "string" ? JSON.parse(phoneNumbers) : phoneNumbers;
  
  if (!Array.isArray(list)) return { contacts, errors: ["Invalid phone numbers format"] };

  list.forEach((entry, idx) => {
    const rawPhone =
      typeof entry === "object" && entry !== null
        ? entry.phone || entry.userContactNumber || entry.mobile || entry.number || ""
        : entry;
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      errors.push(`Index ${idx}: Invalid phone "${rawPhone}"`);
      return;
    }

    const normalizedContact =
      typeof entry === "object" && entry !== null
        ? {
            ...entry,
            phone,
            name: String(entry.name || entry.fullName || `User ${idx + 1}`).trim(),
            email: String(entry.email || "").trim(),
          }
        : {
            phone,
            name: `User ${idx + 1}`,
          };

    contacts.push(normalizedContact);
  });

  return { contacts, errors };
};

/**
 * Resolve template variable values for a single contact.
 * Handles both:
 * 1. Array format from mobile: [ { variable: "{{1}}", value: "Rahul" }, { variable: "{{2}}", value: "11243" } ]
 * 2. Object format: { "1": "name", "2": "order_id" } or { "{{1}}": "Rahul" }
 */
const resolveVariables = (contact, variableMapping) => {
  const resolved = {};

  if (Array.isArray(variableMapping)) {
    for (const item of variableMapping) {
      if (!item) continue;
      const pos = String(item.variable || "").replace(/\D/g, "");
      if (!pos) continue;

      const rawVal = item.value !== undefined && item.value !== null ? String(item.value).trim() : "";
      if (rawVal && contact[rawVal] !== undefined && contact[rawVal] !== "") {
        resolved[pos] = String(contact[rawVal]);
      } else if (rawVal) {
        resolved[pos] = rawVal;
      } else if (pos === "1" && contact.name) {
        resolved[pos] = String(contact.name);
      } else if (contact.phone) {
        resolved[pos] = String(contact.phone);
      } else {
        resolved[pos] = "Customer";
      }
    }
  } else if (variableMapping && typeof variableMapping === "object") {
    for (const [key, fieldName] of Object.entries(variableMapping)) {
      const pos = String(key).replace(/\D/g, "");
      if (!pos) continue;

      if (typeof fieldName === "object" && fieldName !== null) {
        const val = fieldName.value || fieldName.val || "";
        if (val && contact[val]) resolved[pos] = String(contact[val]);
        else if (val) resolved[pos] = String(val);
        else resolved[pos] = String(contact.name || contact.phone || "Customer");
      } else {
        const field = String(fieldName || "").trim();
        if (field && contact[field] !== undefined && contact[field] !== "") {
          resolved[pos] = String(contact[field]);
        } else if (field) {
          resolved[pos] = field;
        } else if (pos === "1" && contact.name) {
          resolved[pos] = String(contact.name);
        } else {
          resolved[pos] = String(contact.phone || "Customer");
        }
      }
    }
  }

  // Safety fallbacks if any expected numeric positions are still undefined
  if (!resolved["1"]) resolved["1"] = String(contact.name || contact.phone || "Customer");
  if (!resolved["2"]) resolved["2"] = String(contact.phone || "12345");

  return resolved;
};

/**
 * Build Meta-compatible components array from resolved variables.
 */
const buildComponents = (variables, templateComponents = []) => {
  if (!variables || Object.keys(variables).length === 0) return [];

  const finalComponents = [];

  // Helper to extract component variables as indices [1, 2, ...]
  const getCompVarIndices = (comp) => {
    if (!comp || !comp.text) return [];
    const matches = comp.text.match(/\{\{\d+\}\}/g);
    return matches ? matches.map(v => v.replace(/\{\{|\}\}/g, "")) : [];
  };

  const getParamText = (idx) => {
    const val = variables[idx] ?? variables[String(idx)] ?? variables[Number(idx) - 1];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      return String(val).trim();
    }
    return "Customer";
  };

  // 1. Process HEADER
  const headerComp = templateComponents.find(c => c.type === "HEADER");
  if (headerComp) {
    const headerIndices = getCompVarIndices(headerComp);
    if (headerIndices.length > 0) {
      finalComponents.push({
        type: "header",
        parameters: headerIndices.map(idx => ({
          type: "text",
          text: getParamText(idx),
        })),
      });
    }
  }

  // 2. Process BODY
  const bodyComp = templateComponents.find(c => c.type === "BODY");
  if (bodyComp) {
    const bodyIndices = getCompVarIndices(bodyComp);
    if (bodyIndices.length > 0) {
      finalComponents.push({
        type: "body",
        parameters: bodyIndices.map(idx => ({
          type: "text",
          text: getParamText(idx),
        })),
      });
    }
  }

  // Fallback: If no components found but we have variables, assume they are all for body (legacy support)
  if (finalComponents.length === 0 && Object.keys(variables).length > 0) {
    const params = Object.keys(variables)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ({ type: "text", text: String(variables[key] || "Customer") }));
    finalComponents.push({ type: "body", parameters: params });
  }

  return finalComponents;
};

/** Messages per minute we fall back to when a campaign does not ask for one. */
const DEFAULT_SEND_RATE_PER_MINUTE = 60;

/**
 * Create message documents in DB and add jobs to BullMQ queue.
 *
 * @param {object} options
 * @param {Date|null} options.startAt send nothing before this moment
 * @param {number} options.ratePerMinute spread the sends at this pace
 *
 * Both are enforced with BullMQ's per-job `delay`: the campaign's start time
 * shifts every job, and the rate spaces them apart. Before this, "schedule for
 * later" and the send-rate picker were collected in the app and then dropped on
 * the floor — every campaign went out immediately, all at once.
 */
const enqueueCampaignMessages = async (campaign, contacts, template, options = {}) => {
  // Build readable text from template for display in chat
  const templateDisplayText = template.bodyText || `Template: ${template.name}`;

  const messages = contacts.map((contact) => {
    // Resolve variables for this contact
    const resolved = resolveVariables(contact, campaign.variableMapping);
    
    // Replace {{1}}, {{2}}, etc. in the template body with actual values
    let personalizedBody = templateDisplayText;
    for (const [pos, val] of Object.entries(resolved)) {
      personalizedBody = personalizedBody.replace(`{{${pos}}}`, val);
    }

    return {
      campaignId: campaign._id,
      businessId: campaign.businessId,
      to: contact.phone,
      contactName: contact.name || "",
      variables: resolved,
      type: "TEMPLATE",
      textBody: personalizedBody,
      templateName: template.name,
      direction: "OUTBOUND",
      status: "QUEUED",
    };
  });

  // Bulk insert all message records
  const inserted = await whatsappMessageModel.insertMany(messages);

  const startAt = options.startAt ? new Date(options.startAt) : null;
  const ratePerMinute = Number(options.ratePerMinute) > 0
    ? Number(options.ratePerMinute)
    : DEFAULT_SEND_RATE_PER_MINUTE;

  // A past or missing start time means "now"; never a negative delay.
  const startDelayMs = startAt ? Math.max(0, startAt.getTime() - Date.now()) : 0;
  const spacingMs = 60000 / ratePerMinute;

  // Add one BullMQ job per message
  const jobs = inserted.map((msg, index) => ({
    name: "send-whatsapp",
    data: {
      messageId: String(msg._id),
      campaignId: String(campaign._id),
      to: msg.to,
      templateName: template.name,
      languageCode: template.language || "en_US",
      components: buildComponents(msg.variables, template.components || []),
    },
    opts: {
      delay: Math.round(startDelayMs + index * spacingMs),
    },
  }));

  await whatsappQueue.addBulk(jobs);

  return inserted.length;
};

const createCampaign = async (data) => {
  return await whatsappCampaignModel.create(data);
};

const getAllCampaigns = async ({ page = 1, status = "", businessId, createdBy, search = "" }) => {
  const query = {};
  if (status) query.status = status;
  if (businessId) query.businessId = businessId;
  if (createdBy) query.createdBy = createdBy;
  if (search) query.name = { $regex: search, $options: "i" };

  const limit = 20;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    whatsappCampaignModel
      .find(query)
      .populate("templateId", "name status language")
      .populate("createdBy", "name mobile email")
      .populate("businessId", "businessName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    whatsappCampaignModel.countDocuments(query),
  ]);

  const formattedData = data.map((c) => {
    const obj = c.toObject();
    return {
      ...obj,
      templateName: obj.templateName || obj.templateId?.name || "",
      totalTargeted: obj.totalContacts || 0,
      totalSent: obj.stats?.sent || 0,
      totalDelivered: obj.stats?.delivered || 0,
      totalRead: obj.stats?.read || 0,
    };
  });

  return { data: formattedData, total, totalPages: Math.ceil(total / limit) || 1, currentPage: page };
};

const getCampaignById = async (id, access = {}) => {
  const query = {
    _id: id,
    ...buildOwnedQuery(access),
  };

  return await whatsappCampaignModel
    .findOne(query)
    .populate("templateId")
    .populate("createdBy", "name email");
};

/**
 * Aggregate stats + paginated message list for a campaign report.
 */
const getCampaignReport = async (campaignId, page = 1, access = {}) => {
  const limit = 20;
  const skip = (page - 1) * limit;

  const campaignQuery = {
    _id: campaignId,
    ...buildOwnedQuery(access),
  };

  const [campaign, messages, totalMessages] = await Promise.all([
    whatsappCampaignModel.findOne(campaignQuery).populate("templateId", "name"),
    whatsappMessageModel
      .find({ campaignId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    whatsappMessageModel.countDocuments({ campaignId }),
  ]);

  if (!campaign) return null;

  const { stats, totalContacts } = campaign;
  const deliveryRate =
    stats.sent > 0 ? ((stats.delivered / stats.sent) * 100).toFixed(1) + "%" : "0%";
  const readRate =
    stats.delivered > 0 ? ((stats.read / stats.delivered) * 100).toFixed(1) + "%" : "0%";

  return {
    campaign,
    stats: { ...stats.toObject(), deliveryRate, readRate, total: totalContacts },
    messages,
    totalPages: Math.ceil(totalMessages / limit) || 1,
    currentPage: page,
  };
};

/**
 * Summary stats for the WhatsApp dashboard.
 */
const getOverallStats = async ({ businessId, createdBy, isAdmin = false } = {}) => {
  const businessModel = require("../models/businessModel");

  let targetBizIds = [];
  if (businessId && mongoose.Types.ObjectId.isValid(businessId)) {
    targetBizIds.push(new mongoose.Types.ObjectId(businessId));
  } else if (businessId) {
    targetBizIds.push(businessId);
  }

  const userObjId =
    createdBy && mongoose.Types.ObjectId.isValid(createdBy)
      ? new mongoose.Types.ObjectId(createdBy)
      : createdBy;

  if (targetBizIds.length === 0 && userObjId && !isAdmin) {
    const userBusinesses = await businessModel
      .find({ userId: userObjId })
      .select("_id");
    targetBizIds = userBusinesses.map((b) => b._id);
  }

  // 1. Campaign aggregation
  const campaignQuery = {};
  if (isAdmin) {
    // Admin sees all
  } else if (targetBizIds.length > 0 && userObjId) {
    campaignQuery.$or = [
      { createdBy: userObjId },
      { businessId: { $in: targetBizIds } },
    ];
  } else if (targetBizIds.length > 0) {
    campaignQuery.businessId = { $in: targetBizIds };
  } else if (userObjId) {
    campaignQuery.createdBy = userObjId;
  }

  const [totalCampaigns, campaignAgg] = await Promise.all([
    whatsappCampaignModel.countDocuments(campaignQuery),
    whatsappCampaignModel.aggregate([
      { $match: campaignQuery },
      {
        $group: {
          _id: null,
          totalSent: { $sum: "$stats.sent" },
          totalDelivered: { $sum: "$stats.delivered" },
          totalRead: { $sum: "$stats.read" },
          totalFailed: { $sum: "$stats.failed" },
          totalContacts: { $sum: "$totalContacts" },
        },
      },
    ]),
  ]);

  const campStats = campaignAgg[0] || {
    totalSent: 0,
    totalDelivered: 0,
    totalRead: 0,
    totalFailed: 0,
    totalContacts: 0,
  };

  // 2. All Outbound Messages aggregation (Campaigns + Direct 1-to-1 CRM messages)
  const ownedCampaigns = await whatsappCampaignModel
    .find(campaignQuery)
    .select("_id");
  const ownedCampaignIds = ownedCampaigns.map((c) => c._id);

  const msgQuery = { direction: "OUTBOUND" };
  if (!isAdmin) {
    const orConditions = [];
    if (targetBizIds.length > 0) {
      orConditions.push({ businessId: { $in: targetBizIds } });
    }
    if (ownedCampaignIds.length > 0) {
      orConditions.push({ campaignId: { $in: ownedCampaignIds } });
    }
    if (orConditions.length > 0) {
      msgQuery.$or = orConditions;
    } else if (userObjId) {
      msgQuery.businessId = { $in: [] };
    }
  }

  const msgAgg = await whatsappMessageModel.aggregate([
    { $match: msgQuery },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  let msgSent = 0;
  let msgDelivered = 0;
  let msgRead = 0;
  let msgFailed = 0;

  msgAgg.forEach((item) => {
    if (item._id === "SENT") msgSent += item.count;
    if (item._id === "DELIVERED") msgDelivered += item.count;
    if (item._id === "READ") msgRead += item.count;
    if (item._id === "FAILED") msgFailed += item.count;
  });

  // Any message that reached READ status was also DELIVERED
  const msgTotalDelivered = msgDelivered + msgRead;
  const msgTotalSent = msgSent + msgTotalDelivered + msgFailed;

  // Max between message collection & campaign aggregates to avoid undercounting
  const totalDelivered = Math.max(campStats.totalDelivered, msgTotalDelivered);
  const totalRead = Math.max(campStats.totalRead, msgRead);
  const totalFailed = Math.max(campStats.totalFailed, msgFailed);
  const totalSent = Math.max(
    campStats.totalSent,
    msgTotalSent,
    totalDelivered + totalFailed
  );
  const totalContacts = Math.max(campStats.totalContacts, totalSent);

  const deliveryRate =
    totalSent > 0
      ? Number(((totalDelivered / totalSent) * 100).toFixed(1))
      : 0;
  const readRate =
    totalDelivered > 0
      ? Number(((totalRead / totalDelivered) * 100).toFixed(1))
      : 0;
  const overallDeliveryRate = `${deliveryRate.toFixed(1)}%`;

  return {
    totalCampaigns,
    totalSent,
    totalMessagesSent: totalSent,
    totalDelivered,
    totalRead,
    totalFailed,
    totalContacts,
    deliveryRate,
    overallDeliveryRate,
    readRate,
  };
};

const requeueQueuedMessages = async (campaignId) => {
  const campaign = await whatsappCampaignModel
    .findById(campaignId)
    .populate("templateId", "name language");

  if (!campaign || !campaign.templateId) {
    throw new Error("Campaign template not found");
  }

  const queuedMessages = await whatsappMessageModel.find({
    campaignId,
    status: "QUEUED",
    metaMessageId: null,
  });

  if (queuedMessages.length === 0) return 0;

  const jobs = queuedMessages.map((msg) => ({
    name: "send-whatsapp",
    data: {
      messageId: String(msg._id),
      campaignId: String(campaign._id),
      to: msg.to,
      templateName: campaign.templateId.name,
      languageCode: campaign.templateId.language || "en_US",
      components: buildComponents(msg.variables || {}, campaign.templateId.components || []),
    },
  }));

  await whatsappQueue.addBulk(jobs);

  return queuedMessages.length;
};

const deleteCampaign = async (id, userId) => {
  const campaign = await whatsappCampaignModel.findById(id);
  if (!campaign) throw new Error("Campaign not found");

  if (campaign.createdBy.toString() !== userId.toString()) {
    throw new Error("Not authorized to delete this campaign");
  }

  // Delete associated messages
  await whatsappMessageModel.deleteMany({ campaignId: id });

  // Delete the campaign
  await whatsappCampaignModel.findByIdAndDelete(id);

  return campaign;
};

module.exports = {
  parseContactsExcel,
  parsePhoneNumbers,
  enqueueCampaignMessages,
  createCampaign,
  getAllCampaigns,
  getCampaignById,
  getCampaignReport,
  getOverallStats,
  requeueQueuedMessages,
  deleteCampaign,
  buildComponents,
};
