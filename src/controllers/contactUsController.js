const ContactUs = require('../models/contactUsModel');

// Create a new contact us entry
exports.createContactUs = async (req, res) => {
    try {
        const { name, email, message, userId } = req.body;
        const newContactUs = new ContactUs({ name, email, message, userId });
        await newContactUs.save();
        res.status(201).json(newContactUs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all contact us entries with pagination and searching
exports.getAllContactUs = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;
        const query = {
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { message: { $regex: search, $options: 'i' } }
            ]
        };

        const contacts = await ContactUs.find(query)
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await ContactUs.countDocuments(query);

        res.status(200).json({
            success:true,
            message: "Contact Us data fetched successfully",
            data:contacts,
            page: Math.ceil(total / limit),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};