const callRequestModel = require("../models/callRequestModel");
const userModel = require("../models/userModel");
const cron = require("node-cron");
const { assignCallToStaff, distributeUnassignedCalls } = require("../services/autoAssignService");

exports.createCall = async (req, res) => {
  const { userId } = req.body;
  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found !",
      });
    }
    if (user.callRequest == true) {
      return res.status(429).json({
        success: false,
        message: "You have already used it today. Try again after 12 AM.",
      });
    }
    const data = await callRequestModel.create({ userId });
    
    // Auto assignment
    await assignCallToStaff(data._id);

    await userModel.findByIdAndUpdate(
      userId,
      { callRequest: true },
      { new: true },
    );
    
    // Fetch updated data with assignedStaff populated
    const updatedData = await callRequestModel.findById(data._id).populate("assignedStaff");

    res.status(201).json({
      success: true,
      message: "Create Call is successfuly",
      data: updatedData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
exports.listCallRequest = async (req, res) => {
  const { page = 1, limit = 20, userId, sort = -1, staffId, startDate, endDate, status, search } = req.query;
  const skip = (page - 1) * limit;
  const filter = {
    ...(userId && { userId }),
    ...(staffId && { assignedStaff: staffId }),
    ...(status && { status }),
    ...(startDate && endDate && {
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    }),
  };
  try {
    const data = await callRequestModel
      .find(filter)
      .populate("userId")
      .populate("assignedStaff")
      .populate("statusUpdatedBy", "name image mobile")
      .sort({ createdAt: parseInt(sort) })
      .skip(skip)
      .limit(limit);
    const total = await callRequestModel.countDocuments(filter);
    res.status(200).json({
      success: true,
      message: "Call Request List is fetched",
      data: data,
      currentPage: page,
      page: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
exports.updateCallRequestStatus = async (req, res) => {
  const { callRequestId } = req.query;
  const { status } = req.body;
  try {
    const call = await callRequestModel.findById(callRequestId);
    if (!call) {
      return res.status(404).json({
        success: false,
        message: "callRequestId not found",
      });
    }

    const data = await callRequestModel.findByIdAndUpdate(
      { _id: callRequestId },
      { 
        status: status,
        ...(status && {
          statusUpdatedAt: new Date(),
          statusUpdatedBy: req.user?._id || req.body?.userId // Use req.user if available, fallback for safety
        })
      },
      { new: true },
    );
    res.status(201).json({
      success: true,
      message: "Status Update Successfully",
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.pushFollowUp = async (req, res) => {
  const { callId } = req.query;
  const { scheduledTime, notes } = req.body;

  if (!scheduledTime) {
    return res.status(400).json({ message: "scheduledTime is required." });
  }

  const updatedCallRequest = await callRequestModel.findByIdAndUpdate(
    callId,
    {
      $push: {
        followUps: {
          scheduledTime,
          notes,
        },
      },
    },
    { new: true, runValidators: true },
  );

  if (!updatedCallRequest) {
    return res.status(404).json({ message: "Call Request not found." });
  }

  res.status(200).json({
    success: true,
    message: "Follow-up added successfully.",
    data: updatedCallRequest,
  });
};

exports.assignCallRequest = async (req, res) => {
  const { callId } = req.query;
  const { staffId } = req.body;

  try {
    const updatedCallRequest = await callRequestModel.findByIdAndUpdate(
      callId,
      {
        assignedStaff: staffId,
        isAssigned: true,
      },
      { new: true },
    );

    if (!updatedCallRequest) {
      return res.status(404).json({
        success: false,
        message: "Call Request not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Staff assigned successfully",
      data: updatedCallRequest,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.autoAssignAll = async (req, res) => {
  try {
    const assignedCount = await distributeUnassignedCalls();
    res.status(200).json({
      success: true,
      message: `${assignedCount} call requests assigned successfully`,
      assignedCount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.deleteFollowUp = async (req, res) => {
  const { callId, noteId } = req.query;

  try {
    const updatedCallRequest = await callRequestModel.findByIdAndUpdate(
      callId,
      {
        $pull: {
          followUps: { _id: noteId },
        },
      },
      { new: true },
    );

    if (!updatedCallRequest) {
      return res.status(404).json({
        success: false,
        message: "Call Request not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Note deleted successfully",
      data: updatedCallRequest,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteCallRequest = async (req, res) => {
  const { callId } = req.query;

  try {
    const data = await callRequestModel.findByIdAndDelete(callId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Call Request not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Call Request deleted successfully",
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const resetCallRequests = async () => {
  try {
    await userModel.updateMany({}, { $set: { callRequest: false } });
    console.log("Successfully reset callRequest for all users");
  } catch (error) {
    console.error("Error resetting callRequest:", error);
  }
};

// Schedule the function to run every day at 12:00 AM
cron.schedule(
  "0 0 * * *",
  () => {
    console.log("Running resetCallRequests at 12:00 AM IST");
    resetCallRequests();
  },
  {
    timezone: "Asia/Kolkata",
  },
);
