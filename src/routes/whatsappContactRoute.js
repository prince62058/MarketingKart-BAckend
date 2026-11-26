const express = require("express");
const router = express.Router();
const { authUser } = require("../middlewares/authMidd");
const ctrl = require("../controllers/whatsappContactController");

// Contacts — fixed paths before /:contactId.
router.get("/whatsapp/contacts", authUser, ctrl.list);
router.get("/whatsapp/contacts/export", authUser, ctrl.exportAll);
router.post("/whatsapp/contacts", authUser, ctrl.create);
router.post("/whatsapp/contacts/bulk", authUser, ctrl.bulk);
router.post("/whatsapp/contacts/import", authUser, ctrl.importRows);
router.post("/whatsapp/contacts/audience", authUser, ctrl.audience);
router.put("/whatsapp/contacts/:contactId", authUser, ctrl.update);
router.delete("/whatsapp/contacts/:contactId", authUser, ctrl.remove);

router.get("/whatsapp/contact-groups", authUser, ctrl.listGroups);
router.post("/whatsapp/contact-groups", authUser, ctrl.createGroup);
router.put("/whatsapp/contact-groups/:groupId", authUser, ctrl.updateGroup);
router.delete("/whatsapp/contact-groups/:groupId", authUser, ctrl.removeGroup);

router.get("/whatsapp/contact-fields", authUser, ctrl.listFields);
router.post("/whatsapp/contact-fields", authUser, ctrl.createField);
router.delete("/whatsapp/contact-fields/:fieldId", authUser, ctrl.removeField);

module.exports = router;
