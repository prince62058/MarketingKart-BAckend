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
    invoiceNumber: {
        type: String,
        trim: true,
    },
    dueDate: {
        type: Date,
    },
    paymentTerms: {
        type: String,
        default: "Net 15 Days",
    },
    // Client Overrides (Editable Bill To)
    clientName: { type: String },
    companyName: { type: String },
    addressLine1: { type: String },
    cityStatePin: { type: String },
    gstin: { type: String },

    // Header & Tagline (Editable)
    tagline: { type: String, default: "Smart Marketing\nStronger Business\nwith AI" },

    // Custom Line Items & Calculations
    items: [
        {
            description: { type: String },
            subDescription: { type: String },
            qty: { type: Number, default: 1 },
            unitPrice: { type: Number, default: 0 },
            amount: { type: Number, default: 0 },
        }
    ],
    subTotal: {
        type: Number,
    },
    gstRate: {
        type: Number,
        default: 18,
    },
    totalAmount: {
        type: Number,
    },
    status: {
        type: String,
        enum: ["PAID", "PENDING", "OVERDUE", "CANCELLED"],
        default: "PAID",
    },

    // Thank You Section (Editable)
    thankYouHeading: { type: String, default: "Thank You!" },
    thankYouText: { type: String, default: "for choosing MarketingKart.ai" },

    // Payment Details Box (Editable)
    bankName: { type: String, default: "HDFC Bank" },
    accountName: { type: String, default: "Ayotrix Infotech Pvt Ltd" },
    accountNumber: { type: String, default: "502000XXXXXXXX" },
    ifscCode: { type: String, default: "HDFC0001234" },
    upiId: { type: String, default: "ayotrix@hdfcbank" },

    // Notes & Signatory (Editable)
    notes: { type: String, default: "Please make the payment within the due date.\nThis is a computer generated invoice and does not require a physical signature.\nFor any queries, feel free to contact us." },
    signatoryFor: { type: String, default: "For MarketingKart.ai" },
    signatoryName: { type: String, default: "Dkumar" },
    signatoryLabel: { type: String, default: "Authorized Signatory" },

    // Bottom Dark Brand Banner (Editable)
    brandParent: { type: String, default: "Ayotrix Infotech Pvt Ltd" },
    brandSubtext: { type: String, default: "IDEAS | TECHNOLOGY | GROWTH" },
    brandPhone: { type: String, default: "+91 98765 43210" },
    brandEmail: { type: String, default: "info@ayotrix.com" },
    brandWebsite: { type: String, default: "www.ayotrix.com" },
    brandCity: { type: String, default: "Indore, Madhya Pradesh, India" },
    brandMotto: { type: String, default: "Let's Build\na Smarter\nTomorrow" },
    bottomServicesBar: { type: String, default: "Social Media Marketing | Google Ads | Meta Ads | WhatsApp Marketing | AI Solutions | Lead Management" },
},

{
    timestamps:true,
}
);

const Invoice = mongoose.model("Invoice", invoiceSchema);

module.exports = Invoice;