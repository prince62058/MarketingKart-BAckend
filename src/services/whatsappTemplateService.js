const whatsappTemplateModel = require("../models/whatsappTemplateModel");
const whatsappCloudApiService = require("./whatsappCloudApiService");

const buildAccessQuery = ({ createdBy, isAdmin = false, businessId } = {}) => {
  const query = { disable: false };
  if (businessId) query.businessId = businessId;
  if (createdBy && !isAdmin) query.createdBy = createdBy;
  return query;
};

/**
 * Extract variable placeholders like {{1}}, {{2}} from template body text.
 */
const extractVariables = (bodyText) => {
  const matches = bodyText.match(/\{\{\d+\}\}/g);
  return matches ? [...new Set(matches)] : [];
};

const createTemplate = async (data) => {
  data.variables = extractVariables(data.bodyText || "");
  return await whatsappTemplateModel.create(data);
};

const getAllTemplates = async ({
  page = 1,
  search = "",
  status = "",
  businessId,
  createdBy,
  isAdmin = false,
}) => {
  const query = buildAccessQuery({ businessId, createdBy, isAdmin });
  if (status) query.status = status;
  if (search) query.name = { $regex: search, $options: "i" };

  const limit = 20;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    whatsappTemplateModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    whatsappTemplateModel.countDocuments(query),
  ]);

  return { data, total, totalPages: Math.ceil(total / limit) || 1, currentPage: page };
};

const getTemplateById = async (id, access = {}) => {
  const query = {
    _id: id,
    ...buildAccessQuery(access),
  };
  return await whatsappTemplateModel.findOne(query);
};

const updateTemplate = async (id, data, access = {}) => {
  if (data.bodyText) {
    data.variables = extractVariables(data.bodyText);
  }

  const query = {
    _id: id,
    ...buildAccessQuery(access),
  };

  return await whatsappTemplateModel.findOneAndUpdate(query, data, { new: true });
};

const deleteTemplate = async (id, access = {}) => {
  const query = {
    _id: id,
    ...buildAccessQuery(access),
  };
  return await whatsappTemplateModel.findOneAndDelete(query);
};

/**
 * Sync template approval status from Meta WABA into local DB.
 * Returns count of updated records.
 */
const syncFromMeta = async (credentials, additionalData = {}) => {
  const metaTemplates = await whatsappCloudApiService.syncTemplatesFromMeta(credentials);
  let updatedCount = 0;

  for (const tpl of metaTemplates) {
    // Find body text (essential for our local search/display)
    const components = tpl.components || [];
    const bodyComp = components.find((c) => c.type === "BODY");
    const headerComp = components.find((c) => c.type === "HEADER");
    
    const bodyText = bodyComp?.text || tpl.name;
    const combinedText = `${headerComp?.text || ""} ${bodyText}`;

    const updateData = {
      name: tpl.name,
      status: tpl.status,
      metaTemplateId: tpl.id,
      category: tpl.category || "MARKETING",
      language: tpl.language || "en_US",
      components: components,
      bodyText,
      variables: extractVariables(combinedText),
      disable: false,
      ...additionalData,
    };

    // Prefer Meta id match (global), then same-owner name, then orphan name without owner.
    const existingTemplate = await whatsappTemplateModel.findOne({
      $or: [
        ...(tpl.id ? [{ metaTemplateId: String(tpl.id) }] : []),
        ...(additionalData.createdBy
          ? [{ createdBy: additionalData.createdBy, name: tpl.name }]
          : []),
        { name: tpl.name, createdBy: { $in: [null, undefined] } },
        { name: tpl.name },
      ],
    }).select("_id");

    let result = null;

    try {
      if (existingTemplate) {
        result = await whatsappTemplateModel.updateOne(
          { _id: existingTemplate._id },
          { $set: updateData }
        );
      } else {
        await whatsappTemplateModel.create(updateData);
        result = { upsertedCount: 1, modifiedCount: 0 };
      }
    } catch (error) {
      if (error?.code === 11000) {
        // Race / unique index: force update the conflicting row.
        const conflict = await whatsappTemplateModel.findOne({
          $or: [
            ...(tpl.id ? [{ metaTemplateId: String(tpl.id) }] : []),
            { name: tpl.name },
          ],
        }).select("_id");
        if (conflict) {
          result = await whatsappTemplateModel.updateOne(
            { _id: conflict._id },
            { $set: updateData }
          );
        } else {
          console.warn(
            `[Template Sync] Skipping duplicate template "${tpl.name}" for user ${additionalData.createdBy || "GLOBAL"}`
          );
          continue;
        }
      } else {
        throw error;
      }
    }

    if (result.modifiedCount > 0 || result.upsertedCount > 0) {
      updatedCount++;
    }
  }

  return updatedCount;
};

module.exports = {
  createTemplate,
  getAllTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
  syncFromMeta,
  extractVariables,
};
