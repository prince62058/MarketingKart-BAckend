const whatsappTemplateModel = require("../models/whatsappTemplateModel");
const whatsappCloudApiService = require("./whatsappCloudApiService");
const { detectTemplateType, flowIdOf } = require("./whatsappTemplateTypes");

const buildAccessQuery = ({ createdBy, isAdmin = false, businessId, wabaId } = {}) => {
  const query = { disable: false };
  if (businessId) query.businessId = businessId;
  if (createdBy && !isAdmin) query.createdBy = createdBy;
  // Only templates for the currently connected WABA.
  if (wabaId && !isAdmin) query.wabaId = String(wabaId);
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
  wabaId,
  isAdmin = false,
}) => {
  const query = buildAccessQuery({ businessId, createdBy, isAdmin, wabaId });
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
 * When the user connects a different WhatsApp number/WABA, drop templates from the old one
 * so the app only shows templates for the currently connected number.
 */
const clearTemplatesOnNumberChange = async (
  userId,
  { previousWabaId, previousPhoneNumberId, newWabaId, newPhoneNumberId } = {}
) => {
  if (!userId) return { deletedCount: 0, changed: false };

  const wabaChanged =
    previousWabaId && newWabaId && String(previousWabaId) !== String(newWabaId);
  const phoneChanged =
    previousPhoneNumberId &&
    newPhoneNumberId &&
    String(previousPhoneNumberId) !== String(newPhoneNumberId);

  // First-time connect (no previous ids) still clears any orphan user templates without a waba.
  const firstConnectCleanup = !previousWabaId && !previousPhoneNumberId;

  if (!wabaChanged && !phoneChanged && !firstConnectCleanup) {
    return { deletedCount: 0, changed: false };
  }

  const result = await whatsappTemplateModel.deleteMany({ createdBy: userId });
  return { deletedCount: result.deletedCount || 0, changed: true };
};

/**
 * Sync template approval status from Meta WABA into local DB.
 * Always scoped to the connecting user + WABA — never steals another user's row by name.
 * Returns count of upserted/updated records.
 */
const syncFromMeta = async (credentials, additionalData = {}) => {
  const metaTemplates = await whatsappCloudApiService.syncTemplatesFromMeta(credentials);
  const ownerId = additionalData.createdBy || null;
  const wabaId = additionalData.wabaId ? String(additionalData.wabaId) : credentials?.wabaId ? String(credentials.wabaId) : null;
  const phoneNumberId = additionalData.phoneNumberId
    ? String(additionalData.phoneNumberId)
    : null;

  // Meta returned nothing for this WABA — drop local templates so the app doesn't
  // keep showing leftovers from a previous Test Number / old WABA.
  if ((!metaTemplates || metaTemplates.length === 0) && ownerId) {
    const cleared = await whatsappTemplateModel.deleteMany({
      createdBy: ownerId,
      ...(wabaId ? { wabaId } : {}),
    });
    return cleared.deletedCount || 0;
  }

  let updatedCount = 0;
  const seenMetaIds = new Set();
  const seenNames = new Set();

  for (const tpl of metaTemplates) {
    const components = tpl.components || [];
    const bodyComp = components.find((c) => c.type === "BODY");
    const headerComp = components.find((c) => c.type === "HEADER");

    const bodyText = bodyComp?.text || tpl.name;
    const combinedText = `${headerComp?.text || ""} ${bodyText}`;
    const metaId = tpl.id ? String(tpl.id) : null;
    const tplName = String(tpl.name || "").toLowerCase().trim();

    if (metaId) seenMetaIds.add(metaId);
    if (tplName) seenNames.add(tplName);

    const updateData = {
      name: tplName,
      status: tpl.status,
      metaTemplateId: metaId,
      templateType: detectTemplateType(components, tpl.category),
      metaFlowId: flowIdOf(components),
      category: tpl.category || "MARKETING",
      language: tpl.language || "en_US",
      components,
      bodyText,
      variables: extractVariables(combinedText),
      disable: false,
      ...(ownerId ? { createdBy: ownerId } : {}),
      ...(wabaId ? { wabaId } : {}),
      ...(phoneNumberId ? { phoneNumberId } : {}),
      ...(additionalData.businessId ? { businessId: additionalData.businessId } : {}),
    };

    // Ownership-scoped match only — never grab another user's template by bare name.
    const orClauses = [];
    if (metaId && ownerId) {
      orClauses.push({ metaTemplateId: metaId, createdBy: ownerId });
    }
    if (metaId && wabaId) {
      orClauses.push({ metaTemplateId: metaId, wabaId });
    }
    if (ownerId && tplName) {
      orClauses.push({ createdBy: ownerId, name: tplName });
    }
    if (wabaId && tplName && ownerId) {
      orClauses.push({ createdBy: ownerId, wabaId, name: tplName });
    }
    // Orphans without owner from older syncs — only if we have an owner to claim them.
    if (ownerId && tplName) {
      orClauses.push({ name: tplName, createdBy: { $in: [null, undefined] } });
    }

    if (orClauses.length === 0) continue;

    const existingTemplate = await whatsappTemplateModel
      .findOne({ $or: orClauses })
      .select("_id createdBy wabaId");

    // Refuse to overwrite another user's template.
    if (
      existingTemplate?.createdBy &&
      ownerId &&
      String(existingTemplate.createdBy) !== String(ownerId)
    ) {
      console.warn(
        `[Template Sync] Skipping "${tplName}" — owned by another user`
      );
      continue;
    }

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
        // Unique name clash: only update if the conflicting row is ours or ownerless.
        const conflict = await whatsappTemplateModel
          .findOne({
            $or: [
              ...(metaId ? [{ metaTemplateId: metaId }] : []),
              { name: tplName },
            ],
          })
          .select("_id createdBy");

        if (
          conflict &&
          (!conflict.createdBy ||
            (ownerId && String(conflict.createdBy) === String(ownerId)))
        ) {
          result = await whatsappTemplateModel.updateOne(
            { _id: conflict._id },
            { $set: updateData }
          );
        } else {
          console.warn(
            `[Template Sync] Skipping duplicate template "${tplName}" for user ${ownerId || "GLOBAL"}`
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

  // Hide local templates for this user/WABA that Meta no longer returns.
  if (ownerId && wabaId) {
    await whatsappTemplateModel.updateMany(
      {
        createdBy: ownerId,
        wabaId,
        disable: false,
        $and: [
          {
            $or: [
              { metaTemplateId: { $nin: [...seenMetaIds] } },
              { metaTemplateId: null },
            ],
          },
          { name: { $nin: [...seenNames] } },
        ],
      },
      { $set: { disable: true } }
    );
  }

  return updatedCount;
};

/**
 * Full connect hook: if the WhatsApp number changed, wipe old templates; then sync the new WABA.
 */
const syncTemplatesForConnectedAccount = async ({
  userId,
  wabaId,
  phoneNumberId,
  accessToken,
  previousWabaId = null,
  previousPhoneNumberId = null,
}) => {
  const cleared = await clearTemplatesOnNumberChange(userId, {
    previousWabaId,
    previousPhoneNumberId,
    newWabaId: wabaId,
    newPhoneNumberId: phoneNumberId,
  });

  const synced = await syncFromMeta(
    { accessToken, wabaId },
    { createdBy: userId, wabaId, phoneNumberId }
  );

  return {
    templatesCleared: cleared.deletedCount,
    numberChanged: cleared.changed,
    templatesSynced: synced,
  };
};

module.exports = {
  createTemplate,
  getAllTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
  syncFromMeta,
  clearTemplatesOnNumberChange,
  syncTemplatesForConnectedAccount,
  extractVariables,
};
