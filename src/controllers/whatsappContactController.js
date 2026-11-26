const contacts = require("../services/whatsappContactService");

// Every handler answers { success: true, ... }; a ContactError keeps its status and message.
const handle = (fn, okStatus = 200) => async (req, res) => {
  try {
    const result = await fn(req);
    return res.status(okStatus).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof contacts.ContactError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("[WA Contacts]", req.method, req.path, error?.message);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};
const owner = (req) => req.user._id;

exports.list = handle(async (req) => contacts.listContacts(owner(req), req.query));
exports.exportAll = handle(async (req) => ({ data: await contacts.exportContacts(owner(req), req.query) }));
exports.create = handle(async (req) => ({ data: await contacts.createContact(owner(req), req.body) }), 201);
exports.update = handle(async (req) => ({ data: await contacts.updateContact(owner(req), req.params.contactId, req.body) }));
exports.remove = handle(async (req) => ({ data: await contacts.deleteContact(owner(req), req.params.contactId) }));
exports.bulk = handle(async (req) => ({ data: await contacts.bulkContacts(owner(req), req.body) }));
exports.importRows = handle(async (req) => ({ data: await contacts.importContacts(owner(req), req.body) }));
exports.audience = handle(async (req) => ({ data: await contacts.audience(owner(req), req.body) }));

exports.listGroups = handle(async (req) => ({ data: await contacts.listGroups(owner(req)) }));
exports.createGroup = handle(async (req) => ({ data: await contacts.saveGroup(owner(req), null, req.body) }), 201);
exports.updateGroup = handle(async (req) => ({ data: await contacts.saveGroup(owner(req), req.params.groupId, req.body) }));
exports.removeGroup = handle(async (req) => ({
  data: await contacts.deleteGroup(owner(req), req.params.groupId, { withContacts: req.query.withContacts === "true" }),
}));

exports.listFields = handle(async (req) => ({ data: await contacts.listFields(owner(req)) }));
exports.createField = handle(async (req) => ({ data: await contacts.createField(owner(req), req.body) }), 201);
exports.removeField = handle(async (req) => ({ data: await contacts.deleteField(owner(req), req.params.fieldId) }));
