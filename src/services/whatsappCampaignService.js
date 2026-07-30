const XLSX = require("xlsx");
const whatsappCampaignModel = require("../models/whatsappCampaignModel");
const whatsappMessageModel = require("../models/whatsappMessageModel");
const whatsappQueue = require("../queues/whatsappQueue");

const buildOwnedQuery = ({ createdBy, isAdmin = false, businessId } = {}) => {
  const query = {};
  if (businessId) query.businessId = businessId;
  if (createdBy && !isAdmin) query.createdBy = createdBy;
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
 * variableMapping: { "1": "name", "2": "phone" } maps {{1}} → contact.name
 */
const resolveVariables = (contact, variableMapping) => {
  const resolved = {};
  for (const [position, fieldName] of Object.entries(variableMapping || {})) {
    resolved[position] = String(contact[fieldName] || contact.phone || "");
  }
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

  // 1. Process HEADER
  const headerComp = templateComponents.find(c => c.type === "HEADER");
  if (headerComp) {
    const headerIndices = getCompVarIndices(headerComp);
    if (headerIndices.length > 0) {
      finalComponents.push({
        type: "header",
        parameters: headerIndices.map(idx => ({
          type: "text",
          text: String(variables[idx] || ""),
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
          text: String(variables[idx] || ""),
        })),
      });
    }
  }

  // Fallback: If no components found but we have variables, assume they are all for body (legacy support)
  if (finalComponents.length === 0 && Object.keys(variables).length > 0) {
    const params = Object.keys(variables)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => ({ type: "text", text: String(variables[key]) }));
    finalComponents.push({ type: "body", parameters: params });
  }

  return finalComponents;
};

/**
 * Create message documents in DB and add jobs to BullMQ queue.
 */
const enqueueCampaignMessages = async (campaign, contacts, template) => {
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

  // Add one BullMQ job per message
  const jobs = inserted.map((msg) => ({
    name: "send-whatsapp",
    data: {
      messageId: String(msg._id),
      campaignId: String(campaign._id),
      to: msg.to,
      templateName: template.name,
      languageCode: template.language || "en_US",
      components: buildComponents(msg.variables, template.components || []),
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
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    whatsappCampaignModel.countDocuments(query),
  ]);

  return { data, total, totalPages: Math.ceil(total / limit) || 1, currentPage: page };
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
  const query = buildOwnedQuery({ businessId, createdBy, isAdmin });

  const [totalCampaigns, aggregate] = await Promise.all([
    whatsappCampaignModel.countDocuments(query),
    whatsappCampaignModel.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalSent: { $sum: "$stats.sent" },
          totalDelivered: { $sum: "$stats.delivered" },
          totalRead: { $sum: "$stats.read" },
          totalContacts: { $sum: "$totalContacts" },
        },
      },
    ]),
  ]);

  const agg = aggregate[0] || { totalSent: 0, totalDelivered: 0, totalRead: 0, totalContacts: 0 };
  const overallDeliveryRate =
    agg.totalSent > 0
      ? ((agg.totalDelivered / agg.totalSent) * 100).toFixed(1) + "%"
      : "0%";

  return {
    totalCampaigns,
    totalMessagesSent: agg.totalSent,
    totalDelivered: agg.totalDelivered,
    totalContacts: agg.totalContacts,
    overallDeliveryRate,
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
