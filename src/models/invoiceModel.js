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
    // The ad package the customer chose (none for a custom budget), as it was named when they paid.
    planId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"planModel"
    },
    packageName: { type: String, trim: true },
    // Which service this bills; it picks the invoice's colours. Missing on older invoices (Meta ads).
    service: { type: String, enum: ["META_ADS", "WHATSAPP", "AI_VIDEO", "RCS"] },
    // Which wording template to print. Empty uses the default for this service.
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "InvoiceTemplate" },
    // How it was paid and the payment's reference, shown on the invoice.
    paymentMethod: { type: String, trim: true },
    transactionId: { type: String, trim: true },
    // True when the price already contains the GST shown (AI Video), false when GST was added on top.
    gstInclusive: { type: Boolean, default: false },
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

    // Every other printed label. Defaults match the template, so a template edit still reaches old bills.
    brandKicker: { type: String, default: "LEADS | AUTOMATE | GROW" },
    poweredByLabel: { type: String, default: "Powered by" },
    billToTitle: { type: String, default: "Bill To" },
    invoiceTitle: { type: String, default: "INVOICE" },
    serviceLabel: { type: String, default: "" },
    invoiceNoLabel: { type: String, default: "Invoice No" },
    invoiceDateLabel: { type: String, default: "Invoice Date" },
    dueDateLabel: { type: String, default: "Due Date" },
    statusLabel: { type: String, default: "Status" },
    paymentTermsLabel: { type: String, default: "Payment Terms" },
    paidViaLabel: { type: String, default: "Paid via" },
    paymentIdLabel: { type: String, default: "Payment ID" },
    paidOnLabel: { type: String, default: "Paid on" },
    paidWord: { type: String, default: "Paid" },
    colHash: { type: String, default: "#" },
    colDescription: { type: String, default: "Description" },
    colQty: { type: String, default: "Qty" },
    colPrice: { type: String, default: "Unit Price (INR)" },
    colAmount: { type: String, default: "Amount (INR)" },
    subtotalLabel: { type: String, default: "Subtotal" },
    gstLabel: { type: String, default: "GST" },
    totalLabel: { type: String, default: "Total Amount (INR)" },
    paymentTitle: { type: String, default: "Payment Details" },
    paymentStatusTitle: { type: String, default: "Payment status" },
    paidTitle: { type: String, default: "Payment" },
    notesTitle: { type: String, default: "Notes" },
    signatoryTitle: { type: String, default: "Authorized Signatory" },
    bankNameLabel: { type: String, default: "Bank Name" },
    accountNameLabel: { type: String, default: "Account Name" },
    accountNumberLabel: { type: String, default: "Account No." },
    ifscLabel: { type: String, default: "IFSC Code" },
    upiLabel: { type: String, default: "UPI ID" },
    brandOfLabel: { type: String, default: "A Brand of" },
    paidNotes: { type: String, default: "This invoice is paid in full.\nThis is a computer generated invoice and does not require a physical signature.\nFor any queries, feel free to contact us." },
    companyGstLabel: { type: String, default: "GST No" },
    companyGstin: { type: String, default: "" },
    customerGstLabel: { type: String, default: "GST No" },
},

{
    timestamps:true,
}
);

const Invoice = mongoose.model("Invoice", invoiceSchema);

module.exports = Invoice;