const WhatsAppSupport = require("../models/whatsappSupportModel");

// User: Create a new support ticket
exports.createTicket = async (req, res) => {
  try {
    const { category, subject, message, callbackRequested, callbackNumber, priority } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ success: false, message: "Subject and message are required" });
    }

    const ticket = await WhatsAppSupport.create({
      userId: req.user._id,
      category: category || "GENERAL",
      subject,
      message,
      priority: priority || "MEDIUM",
      callbackRequested: callbackRequested || false,
      callbackNumber: callbackNumber || "",
    });

    if (global.io) {
      global.io.emit("ticketUpdate", {
        ticketId: ticket._id,
        status: ticket.status,
        message: "New support ticket created",
        userId: req.user._id
      });
    }

    return res.status(201).json({ success: true, message: "Ticket created successfully", data: ticket });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// User: Get my tickets
exports.getMyTickets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const status = req.query.status || "";

    const filter = { userId: req.user._id };
    if (status) filter.status = status;

    const [tickets, total] = await Promise.all([
      WhatsAppSupport.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      WhatsAppSupport.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: tickets,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// User: Get single ticket with replies
exports.getTicketById = async (req, res) => {
  try {
    const ticket = await WhatsAppSupport.findOne({
      _id: req.params.ticketId,
      userId: req.user._id,
    }).lean();

    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });
    return res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// User: Reply to own ticket
exports.userReply = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: "Message is required" });

    const ticket = await WhatsAppSupport.findOneAndUpdate(
      { _id: req.params.ticketId, userId: req.user._id },
      {
        $push: { replies: { message, sender: "USER" } },
        $set: { status: "OPEN" },
      },
      { new: true }
    );

    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    // Emit real-time update for Admin Dashboard
    if (global.io) {
      global.io.emit("ticketUpdate", {
        ticketId: ticket._id,
        status: ticket.status,
        message: "New message from user",
        userId: req.user._id
      });
    }

    return res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Admin Endpoints ──────────────────────────────────────────────

// Admin: Get all tickets
exports.getAllTickets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const { status, category, search, priority } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: "i" } },
        { message: { $regex: search, $options: "i" } },
      ];
    }

    const [tickets, total] = await Promise.all([
      WhatsAppSupport.find(filter)
        .populate("userId", "name mobile email businessName")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      WhatsAppSupport.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: tickets,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Get ticket stats
exports.getTicketStats = async (req, res) => {
  try {
    const [open, inProgress, resolved, closed, callbacks] = await Promise.all([
      WhatsAppSupport.countDocuments({ status: "OPEN" }),
      WhatsAppSupport.countDocuments({ status: "IN_PROGRESS" }),
      WhatsAppSupport.countDocuments({ status: "RESOLVED" }),
      WhatsAppSupport.countDocuments({ status: "CLOSED" }),
      WhatsAppSupport.countDocuments({ callbackRequested: true, status: { $nin: ["RESOLVED", "CLOSED"] } }),
    ]);

    return res.status(200).json({
      success: true,
      data: { open, inProgress, resolved, closed, callbacks, total: open + inProgress + resolved + closed },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Reply to ticket
exports.adminReply = async (req, res) => {
  try {
    const { message, status } = req.body;
    if (!message) return res.status(400).json({ success: false, message: "Message is required" });

    const update = {
      $push: { replies: { message, sender: "ADMIN", senderName: "Support Team" } },
    };
    if (status) update.$set = { status };

    const ticket = await WhatsAppSupport.findByIdAndUpdate(req.params.ticketId, update, { new: true })
      .populate("userId", "name mobile email businessName");

    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    // Emit real-time update to the user
    if (global.io && ticket.userId) {
      const uId = ticket.userId._id || ticket.userId;
      global.io.to(`user:${uId}`).emit("ticketUpdate", {
        ticketId: ticket._id,
        status: ticket.status,
        message: "New reply from support team"
      });
    }

    // Also notify admin dashboards to update list/detail in real time
    if (global.io) {
      global.io.emit("ticketUpdate", {
        ticketId: ticket._id,
        status: ticket.status,
        message: "Support team replied",
        userId: ticket.userId?._id || ticket.userId
      });
    }

    return res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Update ticket status
exports.updateTicketStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const ticket = await WhatsAppSupport.findByIdAndUpdate(
      req.params.ticketId,
      { status },
      { new: true }
    );

    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });

    if (global.io) {
      global.io.emit("ticketUpdate", {
        ticketId: ticket._id,
        status: ticket.status,
        message: "Ticket status updated",
        userId: ticket.userId
      });
      global.io.to(`user:${ticket.userId}`).emit("ticketUpdate", {
        ticketId: ticket._id,
        status: ticket.status,
        message: "Ticket status updated"
      });
    }

    return res.status(200).json({ success: true, data: ticket });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
