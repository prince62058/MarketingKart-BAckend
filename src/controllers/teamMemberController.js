const TeamMember = require("../models/teamMemberModel");
const Business = require("../models/businessModel");

async function assertOwnsBusiness(businessId, userId) {
  const business = await Business.findById(businessId);
  if (!business) {
    const err = new Error("Business not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(business.userId) !== String(userId)) {
    const err = new Error("You do not have access to this business");
    err.statusCode = 403;
    throw err;
  }
  return business;
}

exports.addTeamMember = async (req, res) => {
  try {
    const { businessId, name, phone, role } = req.body;
    if (!businessId || !name || !phone) {
      return res.status(400).json({
        success: false,
        message: "businessId, name and phone are required",
      });
    }

    await assertOwnsBusiness(businessId, req.user._id);

    const member = await TeamMember.create({
      businessId,
      ownerId: req.user._id,
      name,
      phone,
      role: ["Admin", "Editor", "Viewer"].includes(role) ? role : "Editor",
    });

    return res.status(201).json({
      success: true,
      message: "Team member invited successfully",
      data: member,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getTeamMembers = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "businessId is required",
      });
    }

    await assertOwnsBusiness(businessId, req.user._id);

    const members = await TeamMember.find({ businessId }).sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      message: "Team members fetched successfully",
      data: members,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateTeamMember = async (req, res) => {
  try {
    const { memberId } = req.params;
    const { role, name, phone } = req.body;

    const member = await TeamMember.findById(memberId);
    if (!member) {
      return res.status(404).json({ success: false, message: "Team member not found" });
    }
    if (String(member.ownerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "You do not have access to this team member" });
    }

    if (role && ["Admin", "Editor", "Viewer"].includes(role)) member.role = role;
    if (name) member.name = name;
    if (phone) member.phone = phone;
    await member.save();

    return res.status(200).json({
      success: true,
      message: "Team member updated successfully",
      data: member,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.removeTeamMember = async (req, res) => {
  try {
    const { memberId } = req.params;

    const member = await TeamMember.findById(memberId);
    if (!member) {
      return res.status(404).json({ success: false, message: "Team member not found" });
    }
    if (String(member.ownerId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "You do not have access to this team member" });
    }

    await member.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Team member removed successfully",
      data: { _id: memberId },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
