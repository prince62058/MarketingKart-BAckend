const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema({
    adsAmount:{
        type:Number,
    },
    commisionAmount:{
         type:Number,
    },
    gstAmount:{
        type:String,
    },
    paymentGetWayFee:{
        type:String,
    },
    userId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"userModel",
    },
    businessId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"business"
    },
    adsTypeId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"advertisementModel"
    },
    transactionId:{
        type:String,
        trim:true
    },
    invoiceURL:{
        type:String,
        trim:true
    }
},
{
    timestamps:true,
}
);

const Invoice = mongoose.model("Invoice", invoiceSchema);

module.exports = Invoice;