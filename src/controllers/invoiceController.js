const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");
const { uploadBuffer } = require("../utils/cloudinaryClient");
const companyModel = require("../models/commpanyModelV2.js");
const businessModel = require("../models/businessModel.js");
const GstOfUserModel = require("../models/GstOfUserModel.js");
const internalCampiagnModel = require("../models/internalCampiagnModel.js");
const adsDetailModel = require("../models/adsDetailModel.js");
const advertisementModel = require("../models/advertisementModel.js");
const invoiceModel = require("../models/invoiceModel.js");
const { mkFullLogoB64, mkIconLogoB64 } = require("../utils/invoiceLogos.js");


const generateInvoiceNumber = async () => {
  try {
    const count = await adsDetailModel.countDocuments();
    const nextInvoiceNumber = count + 1;
    return nextInvoiceNumber.toString().padStart(3, "0");
  } catch (error) {
    throw new Error("Failed to generate invoice number: " + error.message);
  }
};

exports.generateInvoice = async (
  intenalId,
  transactionId,
  facebookBudget,
  instaBudget,
  googleBudget
) => {
  // const { businessId, facebookBudget, instaBudget, googleBudget, addTypeId } = req.body;

  try {
    let ins = intenalId[0];
    // Fetch data with error handling
    const companyData = await companyModel.findOne();
    const advertismentType = await advertisementModel.findById(ins?.addTypeId);
    const business = await businessModel.findById(ins?.businessId);

    const checkUserBil = await GstOfUserModel.findOne({
      userId: business?.userId,
    });

  let adata =  checkUserBil
      ? `<p style="font-weight: 900">
                <strong>${checkUserBil.gstRegisteredName || "N/A"}</strong>
              </p>
              <p>GST NO.: ${checkUserBil?.gstNumber || "N/A"}</p>
              <p>Address: ${checkUserBil?.address || "N/A"}</p>`
      : `<p style="font-weight: 900">
                <strong>${business?.businessName || "N/A"}</strong>
              </p>
              <p>Email: ${business?.businessEmail || "N/A"}</p>
              <p>Phone: ${business?.businessContact || "N/A"}</p>`;

    const addType =
      advertismentType.advertisementType == "OUTCOME_LEADS"
        ? "Lead Ads"
        : "OUTCOME_TRAFFIC"
          ? "Traffic Ads"
          : "OUTCOME_APP_INSTALLS"
            ? "App Install Ads"
            : "OUTCOME_SALES"
              ? "Sales Ads"
              : "OUTCOME_ENGAGEMENT"
                ? "Engagement Ads"
                : "OUTCOME_AWARENESS"
                  ? "Awareness Ads"
                  : "N/A";
    const fbBudget = Number(facebookBudget) || 0;
    const inBudget = Number(instaBudget) || 0;
    const gBudget = Number(googleBudget) || 0;
    const Amount =
      (Number(facebookBudget) || 0) +
      (Number(instaBudget) || 0) +
      (Number(googleBudget) || 0);

    const gstPercent = Number(companyData?.gstFee ?? 18);
    const platformPercent = Number(companyData?.serviceFee ?? 15);
    const gatewayPercent = Number(companyData?.paymentGetWayFee ?? 2);

    const GST = (Amount * gstPercent) / 100;
    const PlatformFee = (Amount * platformPercent) / 100;
    let amount = PlatformFee + Amount;
    const PaymentGetwayFee = (amount * gatewayPercent) / 100;
    const totalAmount = amount + PaymentGetwayFee;
    // console.log(addwithgst, "addwithgst");
    console.log(fbBudget, "fbBudget");
    console.log(inBudget, "inBudget");
    console.log(gBudget, "gBudget");
    const date = new Date().toISOString().split("T")[0];
    const invoiceNumber = await generateInvoiceNumber();

    // HTML Content for PDF
    const htmlContent = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Tax Invoice - ${invoiceNumber}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #FFFFFF;
            color: #0F172A;
            padding: 40px;
            font-size: 13px;
            line-height: 1.5;
          }
          .header-table {
            width: 100%;
            border-bottom: 2px solid #FF6B00;
            padding-bottom: 24px;
            margin-bottom: 28px;
          }
          .brand-title {
            font-size: 26px;
            font-weight: 800;
            color: #FF6B00;
            letter-spacing: -0.5px;
          }
          .brand-subtitle {
            font-size: 12px;
            color: #64748B;
            margin-top: 2px;
          }
          .invoice-badge {
            display: inline-block;
            background-color: #FFF7ED;
            border: 1px solid #FFEDD5;
            color: #EA580C;
            font-size: 18px;
            font-weight: 800;
            padding: 6px 16px;
            border-radius: 8px;
            text-align: right;
          }
          .info-grid {
            width: 100%;
            margin-bottom: 28px;
            border-collapse: collapse;
          }
          .info-col {
            width: 50%;
            vertical-align: top;
            padding: 16px;
            background-color: #F8FAFC;
            border: 1px solid #E2E8F0;
            border-radius: 12px;
          }
          .info-title {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #FF6B00;
            margin-bottom: 8px;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid #E2E8F0;
          }
          .items-table th {
            background-color: #F1F5F9;
            color: #334155;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            padding: 12px 16px;
            text-align: left;
          }
          .items-table td {
            padding: 14px 16px;
            border-bottom: 1px solid #E2E8F0;
            color: #1E293B;
          }
          .totals-table {
            width: 320px;
            margin-left: auto;
            border-collapse: collapse;
            margin-bottom: 30px;
          }
          .totals-table td {
            padding: 8px 12px;
            font-size: 13px;
          }
          .totals-table .total-row td {
            border-top: 2px solid #FF6B00;
            font-size: 16px;
            font-weight: 800;
            color: #FF6B00;
            padding-top: 12px;
          }
          .footer {
            border-top: 1px solid #E2E8F0;
            padding-top: 20px;
            text-align: center;
            font-size: 11px;
            color: #94A3B8;
          }
        </style>
      </head>
      <body>
        <table class="header-table">
          <tr>
            <td>
              <div class="brand-title">MarketingKart<span style="color: #0F172A;">.ai</span></div>
              <div class="brand-subtitle">AI-Powered Marketing & Lead Growth Platform</div>
            </td>
            <td style="text-align: right;">
              <div class="invoice-badge">TAX INVOICE</div>
              <div style="margin-top: 8px; font-size: 12px; color: #64748B;">
                <strong>Invoice #:</strong> MK-INV-${invoiceNumber}<br/>
                <strong>Date:</strong> ${date}<br/>
                <strong>Txn ID:</strong> ${transactionId || "N/A"}
              </div>
            </td>
          </tr>
        </table>

        <table class="info-grid">
          <tr>
            <td class="info-col" style="margin-right: 10px;">
              <div class="info-title">Sold By (Service Provider)</div>
              <p style="font-weight: 700; color: #0F172A; font-size: 14px;">${companyData?.name || "MarketingKart.ai"}</p>
              <p style="color: #475569; margin-top: 4px;">${companyData?.address || "India"}</p>
              <p style="color: #475569; margin-top: 2px;">Email: ${companyData?.email || "support@marketingkart.in"}</p>
              <p style="color: #475569; margin-top: 2px;">Phone: ${companyData?.phone || "N/A"}</p>
            </td>
            <td style="width: 20px;"></td>
            <td class="info-col">
              <div class="info-title">Billed To (Client)</div>
              ${adata}
            </td>
          </tr>
        </table>

        <table class="items-table">
          <thead>
            <tr>
              <th>Description / Campaign</th>
              <th>Channel</th>
              <th style="text-align: right;">Taxable Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>${advertismentType?.title || "Ad Campaign"}</strong>
                <div style="font-size: 11px; color: #64748B; margin-top: 2px;">Meta Ad Placement & Lead Optimization</div>
              </td>
              <td>${addType}</td>
              <td style="text-align: right; font-weight: 600;">₹${Amount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <table class="totals-table">
          <tr>
            <td style="color: #64748B;">Ad Budget Spend:</td>
            <td style="text-align: right; font-weight: 600;">₹${Amount.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="color: #64748B;">Platform Fee (${platformPercent}%):</td>
            <td style="text-align: right; font-weight: 600;">₹${PlatformFee.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="color: #64748B;">GST (${gstPercent}%):</td>
            <td style="text-align: right; font-weight: 600;">₹${GST.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="color: #64748B;">Payment Gateway (${gatewayPercent}%):</td>
            <td style="text-align: right; font-weight: 600;">₹${PaymentGetwayFee.toFixed(2)}</td>
          </tr>
          <tr class="total-row">
            <td>Total Paid:</td>
            <td style="text-align: right;">₹${totalAmount.toFixed(2)}</td>
          </tr>
        </table>

        <div class="footer">
          <p>Thank you for choosing MarketingKart.ai for your business marketing!</p>
          <p style="margin-top: 4px;">This is a computer-generated tax invoice and requires no physical signature.</p>
        </div>
      </body>
    </html>`;

    // Generate PDF
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
      timeout: 60000,
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "load" });
    const pdfBuffer = await page.pdf({ format: "A4" });
    await browser.close();

    // Upload PDF to Cloudinary
    const uploadedFile = await uploadBuffer(pdfBuffer, {
      folder: "MARKETINGKART/INVOICES",
      resourceType: "raw",
      publicId: `invoice-${Date.now()}`,
    });
    const invoiceUrl = uploadedFile.secure_url;

    // Send Email
    const user = process.env.EMAIL_USER || "ayotrix1@gmail.com";
    const pass = process.env.EMAIL_PASS || "ijewaofeggqbwmmm";

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user,
        pass,
      },
    });

    const mailOptions = {
      from: `"MarketingKart.ai" <${user}>`,
      to: business?.businessEmail,
      subject: `🧾 Your MarketingKart.ai Tax Invoice (#MK-INV-${invoiceNumber})`,
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Tax Invoice</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #F8FAFC; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" style="width: 100%; max-width: 560px; border-collapse: collapse; background-color: #FFFFFF; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #E2E8F0;">
          
          <!-- Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #FF6B00 0%, #FF8800 100%); padding: 35px 30px; text-align: center;">
              <h1 style="margin: 0; color: #FFFFFF; font-size: 26px; font-weight: 800;">MarketingKart<span style="opacity: 0.9;">.ai</span></h1>
              <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Payment Received & Invoice Confirmation</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 35px 30px;">
              <p style="margin: 0 0 16px 0; font-size: 16px; color: #0F172A; font-weight: 700;">
                Hello ${business?.businessName || "Valued Customer"},
              </p>
              <p style="margin: 0 0 24px 0; color: #64748B; font-size: 14px; line-height: 22px;">
                Thank you for your payment. Your ad campaign order has been confirmed, and your official GST tax invoice has been generated.
              </p>

              <!-- Summary Card -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #F8FAFC; border-radius: 14px; border: 1px solid #E2E8F0; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #E2E8F0;">
                    <span style="color: #64748B; font-size: 13px;">Invoice Number:</span>
                    <strong style="float: right; color: #0F172A; font-size: 13px;">#MK-INV-${invoiceNumber}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #E2E8F0;">
                    <span style="color: #64748B; font-size: 13px;">Campaign:</span>
                    <strong style="float: right; color: #0F172A; font-size: 13px;">${advertismentType?.title || "Ad Campaign"}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px solid #E2E8F0;">
                    <span style="color: #64748B; font-size: 13px;">Date:</span>
                    <strong style="float: right; color: #0F172A; font-size: 13px;">${date}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px; background-color: #FFF7ED; border-radius: 0 0 14px 14px;">
                    <span style="color: #EA580C; font-size: 14px; font-weight: 700;">Total Amount Paid:</span>
                    <strong style="float: right; color: #EA580C; font-size: 17px; font-weight: 800;">₹${totalAmount.toFixed(2)}</strong>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; color: #64748B; font-size: 13px; line-height: 20px;">
                📎 <strong>Attachment:</strong> A PDF copy of your tax invoice is attached to this email for your accounting records.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; text-align: center; background-color: #FAFAFA; border-top: 1px solid #F1F5F9;">
              <p style="margin: 0; color: #64748B; font-size: 12px;">
                © ${new Date().getFullYear()} MarketingKart.ai — All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      attachments: [
        {
          filename: `Invoice-MK-${invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    console.log("Invoice sent successfully to", business?.businessEmail);

    const data = await new invoiceModel({
      adsAmount: parseInt(Amount),
      commisionAmount: PlatformFee,
      gstAmount: GST,
      paymentGetWayFee: PaymentGetwayFee,
      userId: business?.userId,
      businessId: business?._id,
      adsTypeId: advertismentType?._id,
      invoiceURL: invoiceUrl,
    });

    await data.save();
  } catch (error) {
    console.error("Error generating invoice:", error);
  }
};

// module.exports = { generateInvoice };
exports.getInvoiceByBusinessId = async (req, res) => {
  try {
    const { businessId,userId, page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const invoices = await invoiceModel.find({ userId });

    const totalInvoices = await invoiceModel.countDocuments({ userId });
    const totalPages = Math.ceil(totalInvoices / parseInt(limit));

    return res.status(200).json({
      success: true,
      message: "Invoices fetched successfully",
      data: invoices,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getInvoiceDetails = async (req, res) => {
  try {
    const invoiceId = req.query.invoiceId || req.params.invoiceId;
    const invoice = await invoiceModel.findById(invoiceId);


    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Invoice details fetched successfully",
      data: invoice,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


exports.getInvoiceByBusinessIdByAdmin = async (req, res) => {
  try {
    const { businessId, userId, page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const filter = { userId };
    if (businessId) {
      filter.businessId = businessId;
    }

    const invoices = await invoiceModel
      .find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "name email mobile") // only return name & email of user
      .populate("businessId", "businessName") // only return businessName
      .populate("adsTypeId", "advertisementType") // only return name of adsType
      .sort({ createdAt: -1 });

    const totalInvoices = await invoiceModel.countDocuments(filter);
    const totalPages = Math.ceil(totalInvoices / parseInt(limit));

    return res.status(200).json({
      success: true,
      message: "Invoices fetched successfully",
      data: invoices,
      currentPage: parseInt(page),
      totalPages,
      totalInvoices,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



const moment = require("moment");

exports.getInvoiceByBusinessIdByAdmins = async (req, res) => {
  try {
    const { page = 1, limit = 20, filterBy, fromDate, toDate } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    // 🔍 Date Filter Logic
    if (filterBy) {
      const now = new Date();
      switch (filterBy) {
        case "today":
          query.createdAt = {
            $gte: moment().startOf("day").toDate(),
            $lte: moment().endOf("day").toDate(),
          };
          break;
        case "week":
          query.createdAt = {
            $gte: moment().startOf("week").toDate(),
            $lte: moment().endOf("week").toDate(),
          };
          break;
        case "month":
          query.createdAt = {
            $gte: moment().startOf("month").toDate(),
            $lte: moment().endOf("month").toDate(),
          };
          break;
        case "year":
          query.createdAt = {
            $gte: moment().startOf("year").toDate(),
            $lte: moment().endOf("year").toDate(),
          };
          break;
      }
    }

    // 🗓️ Manual Date Range (fromDate - toDate)
    if (fromDate && toDate) {
      query.createdAt = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }

    const invoices = await invoiceModel
      .find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .populate("userId", "name email mobile")
      .populate("businessId", "businessName businessEmail businessContact")
      .populate("adsTypeId", "advertisementType")
      .sort({ createdAt: -1 });

    const totalInvoices = await invoiceModel.countDocuments(query);
    const totalPages = Math.ceil(totalInvoices / parseInt(limit));

    return res.status(200).json({
      success: true,
      message: "Invoices fetched successfully",
      data: invoices,
      currentPage: parseInt(page),
      totalPages,
      totalInvoices,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Create / Generate Custom or Dynamic Invoice
exports.createInvoice = async (req, res) => {
  try {
    const { 
      userId, 
      businessId, 
      items = [], 
      subTotal, 
      gstAmount, 
      totalAmount, 
      dueDate, 
      paymentTerms = "Net 15 Days",
      status = "PAID" 
    } = req.body;

    const companyData = await companyModel.findOne();
    const prefix = companyData?.invoicePrefix || "MKAI";
    const year = new Date().getFullYear();
    const count = await invoiceModel.countDocuments();
    const invoiceNumber = `${prefix}/${year}/${String(count + 1).padStart(4, "0")}`;

    const calculatedSubTotal = subTotal !== undefined 
      ? Number(subTotal) 
      : items.reduce((acc, it) => acc + (Number(it.amount) || (Number(it.qty) * Number(it.unitPrice)) || 0), 0);
    const calculatedGst = gstAmount !== undefined ? Number(gstAmount) : Math.round(calculatedSubTotal * 0.18);
    const calculatedTotal = totalAmount !== undefined ? Number(totalAmount) : (calculatedSubTotal + calculatedGst);

    const newInvoice = await invoiceModel.create({
      userId,
      businessId,
      invoiceNumber,
      items: items.map((it) => ({
        description: it.description,
        subDescription: it.subDescription || "",
        qty: Number(it.qty) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        amount: Number(it.amount) || (Number(it.qty || 1) * Number(it.unitPrice || 0)),
      })),
      subTotal: calculatedSubTotal,
      gstAmount: String(calculatedGst),
      totalAmount: calculatedTotal,
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 15 * 86400000),
      paymentTerms,
      status,
    });

    const populated = await invoiceModel
      .findById(newInvoice._id)
      .populate("userId", "name email mobile")
      .populate("businessId", "businessName businessEmail businessContact");

    return res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      data: populated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update invoice details (editable from admin)
exports.updateInvoice = async (req, res) => {
  try {
    const invoiceId = req.query.invoiceId || req.params.invoiceId;
    const { items, subTotal, gstAmount, totalAmount, dueDate, paymentTerms, status, invoiceNumber } = req.body;

    const updateFields = {};
    if (items) {
      updateFields.items = items.map((it) => ({
        description: it.description,
        subDescription: it.subDescription || "",
        qty: Number(it.qty) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        amount: Number(it.amount) || (Number(it.qty || 1) * Number(it.unitPrice || 0)),
      }));
    }
    if (subTotal !== undefined) updateFields.subTotal = Number(subTotal);
    if (gstAmount !== undefined) updateFields.gstAmount = String(gstAmount);
    if (totalAmount !== undefined) updateFields.totalAmount = Number(totalAmount);
    if (dueDate) updateFields.dueDate = new Date(dueDate);
    if (paymentTerms) updateFields.paymentTerms = paymentTerms;
    if (status) updateFields.status = status;
    if (invoiceNumber) updateFields.invoiceNumber = invoiceNumber;

    const updated = await invoiceModel.findByIdAndUpdate(
      invoiceId,
      { $set: updateFields },
      { new: true }
    )
    .populate("userId", "name email mobile")
    .populate("businessId", "businessName businessEmail businessContact");

    if (!updated) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Invoice updated successfully",
      data: updated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Delete invoice
exports.deleteInvoice = async (req, res) => {
  try {
    const invoiceId = req.query.invoiceId || req.params.invoiceId;
    await invoiceModel.findByIdAndDelete(invoiceId);
    return res.status(200).json({ success: true, message: "Invoice deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Render styled HTML matching reference invoice template
exports.getInvoiceHTML = async (req, res) => {
  try {
    const invoiceId = req.query.invoiceId || req.params.invoiceId;
    const invoice = await invoiceModel
      .findById(invoiceId)
      .populate("userId")
      .populate("businessId");

    if (!invoice) {
      return res.status(404).send("Invoice not found");
    }

    const companyData = await companyModel.findOne();
    const userGst = await GstOfUserModel.findOne({ userId: invoice.userId?._id });

    // Client / Bill To (per-invoice editable override -> user GST / User / Business -> Default)
    const clientName = invoice.clientName || userGst?.gstRegisteredName || invoice.businessId?.businessName || invoice.userId?.name || "Client Name";
    const companyName = invoice.companyName || invoice.businessId?.businessName || "Company Name";
    const address = invoice.addressLine1 || userGst?.address || "Address Line 1";
    const cityStatePin = invoice.cityStatePin || userGst?.cityState || "City, State - PIN";
    const gstNo = invoice.gstin ? `GSTIN: ${invoice.gstin}` : (userGst?.gstNumber ? `GSTIN: ${userGst.gstNumber}` : "");

    // Tagline (per-invoice editable override -> companyData -> Default)
    const tagline = (invoice.tagline || companyData?.invoiceTagline || "Smart Marketing\nStronger Business\nwith AI").replace(/\n/g, "<br/>");

    // Thank You Text
    const thankYouHeading = invoice.thankYouHeading || "Thank You!";
    const thankYouText = invoice.thankYouText || companyData?.invoiceThankYouText || "for choosing MarketingKart.ai";

    // Bank & Payment Details (per-invoice editable override -> companyData -> Default)
    const bankName = invoice.bankName || companyData?.invoiceBankName || "HDFC Bank";
    const accountName = invoice.accountName || companyData?.invoiceAccountName || "Ayotrix Infotech Pvt Ltd";
    const accountNumber = invoice.accountNumber || companyData?.invoiceAccountNumber || "502000XXXXXXXX";
    const ifscCode = invoice.ifscCode || companyData?.invoiceIfscCode || "HDFC0001234";
    const upiId = invoice.upiId || companyData?.invoiceUpiId || "ayotrix@hdfcbank";

    // Notes & Signatory (per-invoice editable override -> companyData -> Default)
    const notesContent = invoice.notes || companyData?.invoiceNotes || "Please make the payment within the due date.\nThis is a computer generated invoice and does not require a physical signature.\nFor any queries, feel free to contact us.";
    const signatoryFor = invoice.signatoryFor || "For MarketingKart.ai";
    const signatoryName = invoice.signatoryName || "Dkumar";
    const signatoryLabel = invoice.signatoryLabel || "Authorized Signatory";

    // Brand Footer (per-invoice editable override -> companyData -> Default)
    const brandParent = invoice.brandParent || companyData?.invoiceBrandParent || "Ayotrix Infotech Pvt Ltd";
    const brandSubtext = invoice.brandSubtext || companyData?.invoiceBrandSubtext || "IDEAS | TECHNOLOGY | GROWTH";
    const brandPhone = invoice.brandPhone || companyData?.phone || "+91 98765 43210";
    const brandEmail = invoice.brandEmail || companyData?.email || "info@ayotrix.com";
    const brandWebsite = invoice.brandWebsite || companyData?.website || "www.ayotrix.com";
    const brandCity = invoice.brandCity || companyData?.invoiceBrandCity || "Indore, Madhya Pradesh, India";
    const brandMotto = (invoice.brandMotto || "Let's Build\na Smarter\nTomorrow").replace(/\n/g, "<br/>");
    const bottomServicesBar = invoice.bottomServicesBar || "Social Media Marketing | Google Ads | Meta Ads | WhatsApp Marketing | AI Solutions | Lead Management";

    const items = (invoice.items && invoice.items.length > 0)
      ? invoice.items
      : [
          {
            description: "Social Media Marketing Service",
            subDescription: "Content creation, posting & management",
            qty: 1,
            unitPrice: invoice.adsAmount || 15999,
            amount: invoice.adsAmount || 15999,
          },
        ];

    const subTotal = invoice.subTotal || items.reduce((a, b) => a + (b.amount || 0), 0);
    const gstVal = parseFloat(invoice.gstAmount) || Math.round(subTotal * 0.18);
    const totalVal = invoice.totalAmount || (subTotal + gstVal);
    const dateFormatted = invoice.createdAt ? moment(invoice.createdAt).format("DD MMM YYYY") : moment().format("DD MMM YYYY");
    const dueDateFormatted = invoice.dueDate ? moment(invoice.dueDate).format("DD MMM YYYY") : moment().add(15, "days").format("DD MMM YYYY");


    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice - ${invoice.invoiceNumber || invoice._id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page {
      size: A4 portrait;
      margin: 6mm 8mm;
    }
    html, body {
      font-family: 'Inter', -apple-system, sans-serif;
      color: #1e293b;
      background: #ffffff;
      padding: 18px 24px;
      max-width: 840px;
      margin: 0 auto;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    @media print {
      html, body { 
        padding: 0 !important; 
        margin: 0 !important;
        max-width: 100% !important;
        width: 100% !important;
      }
      .no-print { display: none !important; }
      .page-container {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
    }
    .brand-logo-wrap {
      display: flex;
      align-items: flex-start;
    }
    .tagline-box {
      text-align: right;
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.35;
      max-width: 220px;
      letter-spacing: -0.2px;
    }
    .invoice-title-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
    }
    .bill-to-title {
      color: #f97316;
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .client-name {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 3px;
    }
    .client-meta {
      font-size: 12px;
      color: #334155;
      line-height: 1.45;
    }
    .invoice-meta-table {
      text-align: right;
    }
    .invoice-heading {
      font-size: 34px;
      font-weight: 900;
      color: #ea580c;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
      line-height: 1;
    }
    .meta-line {
      font-size: 12px;
      color: #334155;
      margin-bottom: 3px;
    }
    .meta-line strong {
      color: #0f172a;
    }
    /* Items Table */
    .table-wrap {
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #f97316;
      margin-bottom: 14px;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
    }
    table.data-table thead th {
      background: #f97316;
      color: #ffffff;
      padding: 9px 12px;
      font-size: 12px;
      font-weight: 700;
      text-align: left;
    }
    table.data-table thead th.text-right { text-align: right; }
    table.data-table thead th.text-center { text-align: center; }
    table.data-table tbody td {
      padding: 8px 12px;
      font-size: 11.5px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
    }
    table.data-table tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .item-desc-title {
      font-weight: 700;
      color: #0f172a;
      font-size: 12px;
    }
    .item-desc-sub {
      font-size: 10.5px;
      color: #64748b;
      margin-top: 1px;
    }
    /* Totals Box */
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 14px;
    }
    .thank-you-wrap {
      padding-top: 4px;
    }
    .thank-you-script {
      font-size: 34px;
      font-family: 'Brush Script MT', cursive, sans-serif;
      color: #f97316;
      line-height: 1;
      transform: rotate(-3deg);
      display: inline-block;
    }
    .thank-you-sub {
      font-size: 12px;
      font-weight: 600;
      color: #334155;
      margin-top: 4px;
    }
    .totals-card {
      width: 310px;
      background: #fff7ed;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #fdba74;
    }
    .totals-card-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      color: #334155;
      border-bottom: 1px solid #fed7aa;
    }
    .totals-card-row.grand-total {
      background: #f97316;
      color: #ffffff;
      font-size: 14px;
      font-weight: 800;
      border-bottom: none;
      padding: 8px 14px;
    }
    /* Lower Details */
    .lower-row {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 14px;
    }
    .payment-details-box {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
    }
    .section-title-orange {
      color: #ea580c;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .detail-line {
      font-size: 11.5px;
      color: #334155;
      margin-bottom: 3px;
      display: flex;
      justify-content: space-between;
    }
    .notes-box {
      flex: 1;
      font-size: 10.5px;
      color: #475569;
      line-height: 1.45;
    }
    .notes-box ul {
      margin-left: 14px;
      margin-top: 2px;
    }
    .signatory-box {
      margin-top: 10px;
      text-align: right;
    }
    .signatory-title {
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
    }
    .sign-script {
      font-family: 'Brush Script MT', cursive;
      font-size: 24px;
      color: #334155;
      margin: 2px 0;
    }
    /* Bottom Banner Footer */
    .bottom-banner {
      background: #0b1329;
      color: #ffffff;
      border-radius: 6px;
      padding: 12px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
    }
    .brand-left-tag {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-left-title {
      font-size: 14.5px;
      font-weight: 800;
      color: #ffffff;
    }
    .brand-left-sub {
      font-size: 8px;
      letter-spacing: 1.3px;
      color: #94a3b8;
      margin-top: 1px;
    }
    .contact-center {
      font-size: 10px;
      color: #cbd5e1;
      line-height: 1.45;
    }
    .smarter-right {
      text-align: right;
      font-size: 12px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.25;
      border-left: 1px solid #334155;
      padding-left: 14px;
    }
    .sub-categories-bar {
      margin-top: 8px;
      text-align: center;
      font-size: 9px;
      color: #64748b;
      letter-spacing: 0.2px;
    }
  </style>


</head>
<body style="margin: 0; padding: 0;">
  <!-- Print & Download Floating Toolbar -->
  <div class="no-print" style="max-width: 820px; margin: 12px auto 6px; text-align: right; padding: 0 16px;">
    <button onclick="window.print()" style="background: #ea580c; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; box-shadow: 0 2px 6px rgba(234,88,12,0.3);">
      🖨️ Print / Download PDF
    </button>
  </div>

  <div class="page-container" style="max-width: 820px; margin: 0 auto; padding: 18px 26px; background: #ffffff; box-sizing: border-box;">
    <!-- Header -->
    <div class="header-row">
      <div class="brand-logo-wrap">
        <div>
          <img src="${mkFullLogoB64}" alt="MarketingKart.ai" style="height: 52px; width: auto; object-fit: contain; display: block;" />
          <div style="font-size: 10px; font-weight: 700; letter-spacing: 3.5px; color: #475569; margin-top: 6px; padding-left: 3px;">
            LEADS &nbsp;|&nbsp; AUTOMATE &nbsp;|&nbsp; GROW
          </div>
        </div>
      </div>
      <div class="tagline-box">
        ${tagline}
      </div>
    </div>



    <!-- Invoice Meta Row -->
    <div class="invoice-title-row">
      <div>
        <div class="bill-to-title">Bill To</div>
        <div class="client-name">${clientName}</div>
        <div class="client-meta">
          ${companyName ? `<div>${companyName}</div>` : ""}
          ${address ? `<div>${address}</div>` : ""}
          ${cityStatePin ? `<div>${cityStatePin}</div>` : ""}
          ${gstNo ? `<div><strong>${gstNo}</strong></div>` : ""}
        </div>
      </div>
      <div class="invoice-meta-table">
        <div class="invoice-heading">INVOICE</div>
        <div class="meta-line">Invoice No &nbsp;&nbsp;: &nbsp;<strong>${invoice.invoiceNumber || `MKAI/${dateFormatted.split(" ")[2]}/${invoice._id.slice(-4)}`}</strong></div>
        <div class="meta-line">Invoice Date : &nbsp;<strong>${dateFormatted}</strong></div>
        <div class="meta-line">Due Date &nbsp;&nbsp;&nbsp;&nbsp;: &nbsp;<strong>${dueDateFormatted}</strong></div>
        <div class="meta-line">Payment Terms: &nbsp;<strong>${invoice.paymentTerms || "Net 15 Days"}</strong></div>
      </div>
    </div>

    <!-- Items Table -->
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>Description</th>
            <th class="text-center" style="width: 60px;">Qty</th>
            <th class="text-right" style="width: 130px;">Unit Price (INR)</th>
            <th class="text-right" style="width: 130px;">Amount (INR)</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => `
            <tr>
              <td style="color: #64748b; font-weight: 600;">${idx + 1}</td>
              <td>
                <div class="item-desc-title">${it.description}</div>
                ${it.subDescription ? `<div class="item-desc-sub">${it.subDescription}</div>` : ""}
              </td>
              <td class="text-center" style="font-weight: 600;">${it.qty || 1}</td>
              <td class="text-right" style="font-weight: 600;">${(Number(it.unitPrice) || 0).toLocaleString("en-IN")}</td>
              <td class="text-right" style="font-weight: 700; color: #0f172a;">${(Number(it.amount) || 0).toLocaleString("en-IN")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <!-- Totals Section -->
    <div class="summary-row">
      <div class="thank-you-wrap">
        <div class="thank-you-script">${thankYouHeading}</div>
        <div class="thank-you-sub">${thankYouText}</div>
      </div>

      <div class="totals-card">
        <div class="totals-card-row">
          <span>Subtotal</span>
          <span>${subTotal.toLocaleString("en-IN")}</span>
        </div>
        <div class="totals-card-row">
          <span>GST (${invoice.gstRate || 18}%)</span>
          <span>${gstVal.toLocaleString("en-IN")}</span>
        </div>
        <div class="totals-card-row grand-total">
          <span>Total Amount (INR)</span>
          <span>₹ ${totalVal.toLocaleString("en-IN")}</span>
        </div>
      </div>
    </div>

    <!-- Payment Details & Notes -->
    <div class="lower-row">
      <div class="payment-details-box">
        <div class="section-title-orange">Payment Details</div>
        <div class="detail-line"><span>Bank Name</span> <strong>: ${bankName}</strong></div>
        <div class="detail-line"><span>Account Name</span> <strong>: ${accountName}</strong></div>
        <div class="detail-line"><span>Account No.</span> <strong>: ${accountNumber}</strong></div>
        <div class="detail-line"><span>IFSC Code</span> <strong>: ${ifscCode}</strong></div>
        <div class="detail-line"><span>UPI ID</span> <strong>: ${upiId}</strong></div>
      </div>

      <div class="notes-box">
        <div class="section-title-orange">Notes:</div>
        <ul>
          ${notesContent
            .split("\n")
            .filter(Boolean)
            .map((n) => `<li>${n}</li>`)
            .join("")}
        </ul>

        <div class="signatory-box">
          <div class="signatory-title">Authorized Signatory<br/>${signatoryFor}</div>
          <div class="sign-script">${signatoryName}</div>
          <div style="font-size: 10px; color: #64748b;">${signatoryLabel}</div>
        </div>
      </div>
    </div>

    <!-- Bottom Dark Footer Banner -->
    <div class="bottom-banner">
      <div class="brand-left-tag">
        <div style="font-size: 8px; color: #94a3b8; font-weight: 500; margin-bottom: 2px;">A Brand of</div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <!-- Official Ayotrix 'A' symbol -->
          <svg width="28" height="28" viewBox="0 0 100 100" fill="none" style="display: block;">
            <polygon points="50,12 88,86 68,86 50,48 32,86 12,86" fill="url(#ayoGrad)" />
            <defs>
              <linearGradient id="ayoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ff7a00" />
                <stop offset="100%" stop-color="#ff3b00" />
              </linearGradient>
            </defs>
          </svg>
          <div>
            <div class="brand-left-title">${brandParent}</div>
            <div class="brand-left-sub">${brandSubtext}</div>
          </div>
        </div>
      </div>


      <div class="contact-center">
        <div>📞 ${brandPhone}</div>
        <div>✉️ ${brandEmail}</div>
        <div>🌐 ${brandWebsite}</div>
        <div>📍 ${brandCity}</div>
      </div>

      <div class="smarter-right">
        ${brandMotto}
      </div>
    </div>

    <div class="sub-categories-bar">
      ${bottomServicesBar}
    </div>
  </div>
</body>
</html>`;



    res.setHeader("Content-Type", "text/html");
    return res.send(html);
  } catch (error) {
    return res.status(500).send("Error rendering invoice: " + error.message);
  }
};

