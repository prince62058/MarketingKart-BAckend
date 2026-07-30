const userRoleModel = require("../models/userRoleModel");

exports.createRole = async (req, res) => {
  const { name } = req.body;
  try {
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    const data = await userRoleModel.create({ name });
    return res.status(201).json({
      success: true,
      message: "User Role Create Successfully",
      data: data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateRole = async (req, res) => {
  const { name, disable, roleId } = req.body;
  try {
    const userRole = await userRoleModel.findById(roleId);
    if (!userRole) {
      return res.status(404).json({
        success: false,
        message: "User Role Not Found",
      });
    }

    userRole.name = name ? name : undefined;
    userRole.disable = disable ? disable : false;
    await userRole.save();
    return res.status(201).json({
      success: true,
      message: "User Role Updated Successfully",
      data: userRole,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getRoleByItsId = async (req, res) => {
  const { roleId } = req.query;
  try {
    const userRole = await userRoleModel.findById(roleId);
    if (!userRole) {
      return res.status(404).json({
        success: false,
        message: "User Role Not Found",
      });
    }

    return res.status(201).json({
      success: true,
      message: "User Role Fetched Successfully",
      data: userRole,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteRoleById = async (req, res) => {
  const { roleId } = req.query;
  try {
    const userRole = await userRoleModel.findById(roleId);
    if (!userRole) {
      return res.status(404).json({
        success: false,
        message: "User Role Not Found",
      });
    }
    const data = await userRoleModel.findByIdAndDelete(roleId);

    return res.status(201).json({
      success: true,
      message: "User Role Deleted Successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.filterUserRole = async (req, res) => {
  const { search, page = 1, limit = 20, sort = -1 } = req.query;
  const skip = (page - 1) * limit;
  const orFilters = [{ name: new RegExp(search, "i") }];

  if (search === "true" || search === "false") {
    const boolValue = search === "true";
    orFilters.push({ disable: boolValue });
  }

  const filter = {
    ...(search && { $or: orFilters }),
  };
  try {
    const userRole = await userRoleModel
      .find(filter)
      .sort({ createdAt: parseInt(sort) })
      .skip(skip)
      .limit(limit);
    const total = await userRoleModel.countDocuments(filter);

    return res.status(201).json({
      success: true,
      message: "All User Role Fetched Successfully",
      data: userRole,
      currentPage: page,
      page: Math.ceil(total / limit),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};