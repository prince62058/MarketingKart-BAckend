const router = require("express");
const route = router.Router();
const { authUser } = require("../middlewares/authMidd");
const ctrl = require("../controllers/whatsappSupportController");

// User routes
route.post("/whatsapp/support/tickets", authUser, ctrl.createTicket);
route.get("/whatsapp/support/my-tickets", authUser, ctrl.getMyTickets);
route.get("/whatsapp/support/tickets/:ticketId", authUser, ctrl.getTicketById);
route.post("/whatsapp/support/tickets/:ticketId/reply", authUser, ctrl.userReply);

// Admin routes
route.get("/whatsapp/support/all-tickets", authUser, ctrl.getAllTickets);
route.get("/whatsapp/support/stats", authUser, ctrl.getTicketStats);
route.post("/whatsapp/support/tickets/:ticketId/admin-reply", authUser, ctrl.adminReply);
route.put("/whatsapp/support/tickets/:ticketId/status", authUser, ctrl.updateTicketStatus);

module.exports = route;
