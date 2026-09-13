const ContactUs = require('../models/contactUsModel');

// Create a new contact us entry
exports.createContactUs = async (req, res) => {
    try {
        const { name, email, phone, message, userId, status = "PENDING" } = req.body;
        const newContactUs = new ContactUs({ name, email, phone, message, userId, status });
        await newContactUs.save();
        res.status(201).json({
            success: true,
            message: "Contact message submitted successfully",
            data: newContactUs
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Get all contact us entries with pagination and searching
exports.getAllContactUs = async (req, res) => {
    try {
        const { page = 1, limit = 100, search = '' } = req.query;
        const parsedLimit = parseInt(limit) || 100;
        const parsedPage = Math.max(1, parseInt(page)) || 1;

        let query = {};
        if (search && search.trim()) {
            query.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { email: { $regex: search.trim(), $options: 'i' } },
                { phone: { $regex: search.trim(), $options: 'i' } },
                { message: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const contacts = await ContactUs.find(query)
            .populate("userId", "name email mobile")
            .sort({ createdAt: -1 })
            .skip((parsedPage - 1) * parsedLimit)
            .limit(parsedLimit);

        const total = await ContactUs.countDocuments(query);

        res.status(200).json({
            success: true,
            message: "Contact Us data fetched successfully",
            data: contacts,
            page: Math.ceil(total / parsedLimit) || 1,
            total,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Delete a contact us entry
exports.deleteContactUs = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await ContactUs.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Contact message not found" });
        }
        res.status(200).json({ success: true, message: "Contact message deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Update contact status (PENDING, IN_PROGRESS, RESOLVED)
exports.updateContactStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const updated = await ContactUs.findByIdAndUpdate(id, { status }, { new: true });
        if (!updated) {
            return res.status(404).json({ success: false, message: "Contact message not found" });
        }
        res.status(200).json({ success: true, message: "Contact status updated successfully", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Full edit of a contact us entry
exports.updateContactUs = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, message, status, notes } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone;
        if (message !== undefined) updateData.message = message;
        if (status !== undefined) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;

        const updated = await ContactUs.findByIdAndUpdate(id, updateData, { new: true });
        if (!updated) {
            return res.status(404).json({ success: false, message: "Contact message not found" });
        }
        res.status(200).json({ success: true, message: "Contact inquiry updated successfully", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};