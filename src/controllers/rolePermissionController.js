const rolePermissionModel = require("../models/userPermissionModel");

exports.createRoleAndPermission = async(req,res)=>{
    const {name, permission} = req.body;
    try{
    if(!name){
        return res.status(400).json({
            success:false,
            message:"Name is required"
        })
    }

    const data = await rolePermissionModel.create({name,permisstion: permission});
    return res.status(201).json({
        success:true,
        message:"User Role Permission Create Successfully",
        data:data
    })
    }catch(error){
      return res.status(500).json({
        success:false,
        message:error.message
      })
    } 
}

exports.updateRolePermission = async(req,res)=>{
    const {name, type, index, rolePermissionId} = req.body;
    try{
     const userRole = await rolePermissionModel.findById(rolePermissionId);
     if(!userRole){
        return res.status(404).json({
            success:false,
            message:"User Role Permission Not Found"
        })
     }


     userRole.permisstion[index] = type? type: userRole.type;
     userRole.name = name? name: userRole.name;
     await userRole.save();
    return res.status(201).json({
        success:true,
        message:"User Role Permission Updated Successfully",
        data:userRole
    })
    }catch(error){
      return res.status(500).json({
        success:false,
        message:error.message
      })
    } 
}

exports.getRolePermissionById = async(req,res)=>{
    const { rolePermissionId} = req.query;
    try{
     const userRole = await rolePermissionModel.findById(rolePermissionId);
     if(!userRole){
        return res.status(404).json({
            success:false,
            message:"User Role Permission Not Found"
        })
     }
     
    return res.status(201).json({
        success:true,
        message:"User Role Permission Fetched Successfully",
        data:userRole
    })
    }catch(error){
      return res.status(500).json({
        success:false,
        message:error.message
      })
    } 
}

exports.deleteRolePermissionById = async(req,res)=>{
    const { rolePermissionId} = req.query;
    try{
     const userRole = await rolePermissionModel.findById(rolePermissionId);
     if(!userRole){
        return res.status(404).json({
            success:false,
            message:"User Role Not Found"
        })
     }
     const data = await rolePermissionModel.findByIdAndDelete(rolePermissionId);
     
    return res.status(201).json({
        success:true,
        message:"User Role Permission Deleted Successfully",
    })
    }catch(error){
      return res.status(500).json({
        success:false,
        message:error.message
      })
    } 
}

exports.filterRolePermission = async(req,res)=>{
    const {search, page=1, limit =20, sort =-1} = req.query;
    const skip = (page-1)*limit;
    const orFilters = [
        {name:new RegExp(search,"i")},
        {permission:new RegExp(search, "i")}
    ];

    const filter = {
        ...(search && {$or:orFilters})
    }
    try{
     const userRole = await rolePermissionModel.find(filter).sort({createdAt:parseInt(sort)}).skip(skip).limit(limit);
     const total = await rolePermissionModel.countDocuments(filter);
     
    return res.status(201).json({
        success:true,
        message:"All User Role Permission Fetched Successfully",
        data:userRole,
        currentPage:page,
        page: Math.ceil(total/limit)
    })
    }catch(error){
      return res.status(500).json({
        success:false,
        message:error.message
      })
    } 
}