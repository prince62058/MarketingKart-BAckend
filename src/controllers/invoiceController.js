const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");
const { uploadBuffer } = require("../utils/spacesClient");
const companyModel = require("../models/commpanyModelV2.js");
const businessModel = require("../models/businessModel.js");
const GstOfUserModel = require("../models/GstOfUserModel.js");
const internalCampiagnModel = require("../models/internalCampiagnModel.js");
const advertisementModel = require("../models/advertisementModel.js");
const invoiceModel = require("../models/invoiceModel.js");
const planModel = require("../models/planModel.js");
const { adInvoiceLines, legacyAdInvoiceLines, campaignDays } = require("../helpers/adInvoice.js");
const { nextInvoiceNumber } = require("../services/serviceInvoiceService");
const { invoiceTheme } = require("../helpers/invoiceThemes.js");
const { pickChrome, escapeHtml, placeholderBank, chromeFromBody } = require("../helpers/invoiceChrome.js");
const { resolveTemplate } = require("../helpers/invoiceTemplates.js");
const { mkFullLogoB64, mkIconLogoB64 } = require("../utils/invoiceLogos.js");
const { ayotrixLogoB64, poweredByBlock, poweredByCss } = require("../utils/ayotrixLogo.js");


exports.generateInvoice = async (
  intenalId,
  transactionId,
  facebookBudget,
  instaBudget,
  googleBudget,
  // { adSpend, total, planId }: the Meta budget, what the customer was actually charged, and the
  // package they chose. The invoice then shows the same lines as the app's "Review & Launch Ad".
  charge = {}
) => {
  try {
    const ins = Array.isArray(intenalId) ? intenalId[0] : intenalId;
    // Fetch data with error handling
    const companyData = await companyModel.findOne();
    const advertismentType = ins?.addTypeId ? await advertisementModel.findById(ins.addTypeId) : null;
    const business = ins?.businessId ? await businessModel.findById(ins.businessId) : null;
    const planId = charge?.planId || ins?.planId || null;
    const plan = planId ? await planModel.findById(planId).select("title duretion").lean() : null;

    // Only this customer's GST details: a lookup without a userId would match someone else's.
    const checkUserBil = business?.userId
      ? await GstOfUserModel.findOne({ userId: business.userId })
      : null;

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

    const budgetSum =
      (Number(facebookBudget) || 0) +
      (Number(instaBudget) || 0) +
      (Number(googleBudget) || 0);
    const lines = adInvoiceLines({
      adSpend: Number(charge?.adSpend) > 0 ? Number(charge.adSpend) : budgetSum,
      total: charge?.total,
      days: campaignDays(ins?.startDate, ins?.endDate) || Number(plan?.duretion) || null,
      // No package means a custom budget; a package that has since been deleted is still a package.
      packageName: planId ? plan?.title || "Ad Package" : null,
      adTypeTitle: advertismentType?.title,
      fees: companyData,
    });

    // Saved before the PDF and the e-mail, so the invoice is there (admin panel and the app's
    // invoices) even when either of them fails. The number is stored with the invoice; the PDF
    // used to invent one afterwards and the app then had nothing to show.
    const invoiceNumber = await nextInvoiceNumber(invoiceModel, companyModel);
    await invoiceModel.create({
      service: "META_ADS",
      invoiceNumber,
      paymentMethod: /^pay_/i.test(String(transactionId || "")) ? "Razorpay" : "MarketingKart wallet",
      transactionId: transactionId ? String(transactionId) : undefined,
      adsAmount: lines.adSpend,
      commisionAmount: lines.platformFee,
      gstAmount: String(lines.gstAmount),
      paymentGetWayFee: String(lines.gatewayFee),
      userId: business?.userId,
      businessId: business?._id,
      adsTypeId: advertismentType?._id,
      planId: plan?._id,
      packageName: lines.packageName,
      items: lines.items,
      subTotal: lines.subTotal,
      gstRate: lines.gstRate,
      totalAmount: lines.totalAmount,
    });

    const rupees = (n) => `₹${(Number(n) || 0).toFixed(2)}`;
    const packageLabel = advertismentType?.title
      ? `${lines.packageName} · ${advertismentType.title}`
      : lines.packageName;
    const date = new Date().toISOString().split("T")[0];

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
          ${poweredByCss}
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
              <th>Package</th>
              <th style="text-align: right;">Ad Budget</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>${lines.packageName}</strong>
                <div style="font-size: 11px; color: #64748B; margin-top: 2px;">${lines.items[0].subDescription}</div>
              </td>
              <td style="text-align: right; font-weight: 600;">${rupees(lines.adSpend)}</td>
            </tr>
          </tbody>
        </table>

        <table class="totals-table">
          <tr>
            <td style="color: #64748B;">${lines.budgetLabel}:</td>
            <td style="text-align: right; font-weight: 600;">${rupees(lines.adSpend)}</td>
          </tr>
          <tr>
            <td style="color: #64748B;">${lines.items[1].description}:</td>
            <td style="text-align: right; font-weight: 600;">${rupees(lines.platformFee)}</td>
          </tr>
          <tr>
            <td style="color: #64748B;">GST (${lines.gstRate}%):</td>
            <td style="text-align: right; font-weight: 600;">${rupees(lines.gstAmount)}</td>
          </tr>
          <tr>
            <td style="color: #64748B;">${lines.items[2].description}:</td>
            <td style="text-align: right; font-weight: 600;">${rupees(lines.gatewayFee)}</td>
          </tr>
          <tr class="total-row">
            <td>Total Paid:</td>
            <td style="text-align: right;">${rupees(lines.totalAmount)}</td>
          </tr>
        </table>

        <div class="footer">
          <p>Thank you for choosing MarketingKart.ai for your business marketing!</p>
          <p style="margin-top: 4px;">This is a computer-generated tax invoice and requires no physical signature.</p>
          ${poweredByBlock()}
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

    // Upload PDF to DigitalOcean Spaces
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
                    <span style="color: #64748B; font-size: 13px;">Package:</span>
                    <strong style="float: right; color: #0F172A; font-size: 13px;">${packageLabel}</strong>
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
                    <strong style="float: right; color: #EA580C; font-size: 17px; font-weight: 800;">${rupees(lines.totalAmount)}</strong>
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

    if (business?.businessEmail) {
      await transporter.sendMail(mailOptions);
      console.log("Invoice sent successfully to", business.businessEmail);
    }
  } catch (error) {
    console.error("Error generating invoice:", error);
  }
};

// module.exports = { generateInvoice };
exports.getInvoiceByBusinessId = async (req, res) => {
  try {
    const { businessId, page = 1, limit = 20 } = req.query;
    // A customer only ever gets their own invoices, whatever userId they ask for.
    const caller = req.authUser || req.user;
    const userId = caller?.userType === "ADMIN" ? req.query.userId : String(caller._id);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const invoices = await invoiceModel.find({ userId }).sort({ createdAt: -1 });

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
    const caller = req.authUser || req.user;

    if (invoice && caller?.userType !== "ADMIN" && String(invoice.userId) !== String(caller?._id)) {
      // Same answer as a missing invoice, so ids cannot be probed.
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

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

    const wording = chromeFromBody(req.body);
    for (const key of ["clientName", "companyName", "addressLine1", "cityStatePin", "gstin"]) {
      if (req.body[key] !== undefined) wording[key] = String(req.body[key] ?? "").slice(0, 300);
    }
    if (req.body.gstRate !== undefined) wording.gstRate = Number(req.body.gstRate) || 0;
    if (/^[0-9a-f]{24}$/i.test(String(req.body.templateId || ""))) wording.templateId = req.body.templateId;
    const newInvoice = await invoiceModel.create({
      userId,
      businessId,
      invoiceNumber,
      ...wording,
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
    Object.assign(updateFields, chromeFromBody(req.body));
    for (const key of ["clientName", "companyName", "addressLine1", "cityStatePin", "gstin"]) {
      if (req.body[key] !== undefined) updateFields[key] = String(req.body[key] ?? "").slice(0, 300);
    }
    if (req.body.gstRate !== undefined) updateFields.gstRate = Number(req.body.gstRate) || 0;
    if (req.body.templateId === null || req.body.templateId === "") updateFields.templateId = null;
    else if (/^[0-9a-f]{24}$/i.test(String(req.body.templateId || ""))) updateFields.templateId = req.body.templateId;

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

// Render styled HTML matching the MarketingKart invoice. Customer lines stay on the invoice;
// wording comes from its template.
async function renderStoredInvoice(invoice) {
  try {
    // The colours of the service this invoice bills (Meta Ads orange, WhatsApp green, ...).
    const theme = invoiceTheme(invoice);
    const companyData = await companyModel.findOne();
    const userGst = invoice.userId?._id ? await GstOfUserModel.findOne({ userId: invoice.userId._id }) : null;

    // Client / Bill To (per-invoice editable override -> user GST / User / Business -> Default)
    const clientName = invoice.clientName || userGst?.gstRegisteredName || invoice.businessId?.businessName || invoice.userId?.name || "Client Name";
    const companyNameRaw = invoice.companyName || invoice.businessId?.businessName || "";
    const companyName = companyNameRaw && companyNameRaw.trim().toLowerCase() !== String(clientName).trim().toLowerCase()
      ? companyNameRaw
      : "";
    const rawAddress = invoice.addressLine1 || userGst?.address || invoice.businessId?.address || "";
    const address = /^address line 1$/i.test(String(rawAddress).trim()) ? "" : rawAddress;
    const rawCity = invoice.cityStatePin || userGst?.cityState || "";
    const cityStatePin = /^city,\s*state\s*-?\s*pin$/i.test(String(rawCity).trim()) ? "" : rawCity;
    const phoneDigits = String(invoice.userId?.mobile || invoice.businessId?.businessContact || "").replace(/\D/g, "");
    const phoneLocal = phoneDigits.length === 12 && phoneDigits.startsWith("91") ? phoneDigits.slice(2) : phoneDigits.length === 10 ? phoneDigits : "";
    const billPhone = phoneLocal ? `+91 ${phoneLocal.slice(0, 5)} ${phoneLocal.slice(5)}` : "";
    const customerGst = String(invoice.gstin || userGst?.gstNumber || "").trim();

    // Wording comes from the invoice's template. A line changed on this bill alone still wins.
    // The logo, colours and table stay the MarketingKart layout.
    const template = await resolveTemplate(invoice);
    const chrome = pickChrome(invoice, template, companyData);
    const e = escapeHtml;
    const tagline = e(chrome.tagline).replace(/\n/g, "<br/>");
    const thankYouHeading = e(chrome.thankYouHeading);
    const thankYouText = e(chrome.thankYouText);
    const bankName = e(chrome.bankName);
    const accountName = e(chrome.accountName);
    const accountNumber = e(chrome.accountNumber);
    const ifscCode = e(chrome.ifscCode);
    const upiId = e(chrome.upiId);
    const notesContent = chrome.notes;
    const signatoryFor = e(chrome.signatoryFor);
    const signatoryName = e(chrome.signatoryName);
    const signatoryLabel = e(chrome.signatoryLabel);
    const brandParent = e(chrome.brandParent);
    const brandSubtext = e(chrome.brandSubtext);
    const brandPhone = e(chrome.brandPhone);
    const brandEmail = e(chrome.brandEmail);
    const brandWebsite = e(chrome.brandWebsite);
    const brandCity = e(chrome.brandCity);
    const brandMotto = e(chrome.brandMotto).replace(/\n/g, "<br/>");
    const bottomServicesBar = e(chrome.bottomServicesBar);
    const label = (key) => e(chrome[key] || "");
    const servicePill = chrome.serviceLabel ? e(chrome.serviceLabel) : e(theme.label);

    // Ad invoices saved before they kept their own lines have only the amounts: show them as the
    // ad budget, platform fee and gateway fee they were, not as a generic service line.
    const isOldAdInvoice = !(invoice.items && invoice.items.length > 0) && invoice.adsAmount != null;
    const items = (invoice.items && invoice.items.length > 0)
      ? invoice.items
      : isOldAdInvoice
        ? legacyAdInvoiceLines(invoice, invoice.adsTypeId?.title).items
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
    // A stored GST of 0 (a WhatsApp recharge) stays 0; only an invoice with no GST stored gets 18%.
    const storedGst = parseFloat(invoice.gstAmount);
    const gstVal = Number.isFinite(storedGst) ? storedGst : Math.round(subTotal * 0.18);
    const gstRate = invoice.gstRate ?? 18;
    const totalVal = invoice.totalAmount || (subTotal + gstVal);
    const paid = String(invoice.status || "").toUpperCase() === "PAID";
    const createdMoment = invoice.createdAt ? moment(invoice.createdAt) : moment();
    const dateFormatted = createdMoment.format("DD MMM YYYY");
    const storedDue = invoice.dueDate ? moment(invoice.dueDate) : null;
    const dueIsUsable = storedDue?.isValid() && !storedDue.isBefore(createdMoment, "day");
    const dueDateFormatted = dueIsUsable
      ? storedDue.format("DD MMM YYYY")
      : createdMoment.clone().add(15, "days").format("DD MMM YYYY");
    const stockPayNote = /please make the payment within the due date/i.test(String(invoice.notes || notesContent || ""));
    const notesForBill = paid && stockPayNote ? chrome.paidNotes : notesContent;
    const invoiceNo = invoice.invoiceNumber || `MKAI/${createdMoment.format("YYYY")}/${String(invoice._id || "").slice(-4).toUpperCase()}`;
    const money = (amount) => Number(amount || 0).toLocaleString("en-IN");
    const bankLooksPlaceholder = !invoice._preview && placeholderBank(chrome.accountNumber, chrome.ifscCode);
    const kv = (rows) => `<table class="kv">${rows.filter(Boolean).map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join("")}</table>`;
    const metaTable = kv([
      [label("invoiceNoLabel"), e(invoiceNo)],
      [label("invoiceDateLabel"), dateFormatted],
      ...(paid
        ? [[label("statusLabel"), label("paidWord")]]
        : [[label("dueDateLabel"), dueDateFormatted], [label("paymentTermsLabel"), e(chrome.paymentTerms || "Net 15 Days")]]),
      invoice.paymentMethod ? [label("paidViaLabel"), e(invoice.paymentMethod)] : null,
      invoice.transactionId ? [label("paymentIdLabel"), e(invoice.transactionId)] : null,
      String(chrome.companyGstin || "").trim() ? [label("companyGstLabel"), e(chrome.companyGstin)] : null,
    ]);
    const paymentTitle = paid ? label("paidTitle") : (bankLooksPlaceholder ? label("paymentStatusTitle") : label("paymentTitle"));
    const paymentTable = paid || bankLooksPlaceholder
      ? kv([
          [label("statusLabel"), paid ? label("paidWord") : e(String(invoice.status || "Due"))],
          invoice.paymentMethod ? [label("paidViaLabel"), e(invoice.paymentMethod)] : null,
          paid ? [label("paidOnLabel"), dateFormatted] : null,
        ])
      : kv([
          [label("bankNameLabel"), bankName],
          [label("accountNameLabel"), accountName],
          [label("accountNumberLabel"), accountNumber],
          [label("ifscLabel"), ifscCode],
          [label("upiLabel"), upiId],
        ]);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice - ${e(invoiceNo)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 portrait; margin: 6mm 8mm; }
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
      html, body { padding: 0 !important; margin: 0 !important; max-width: 100% !important; width: 100% !important; }
      .no-print { display: none !important; }
      .page-container { page-break-inside: avoid !important; break-inside: avoid !important; }
    }
    .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
    .tagline-box { text-align: right; font-size: 14px; font-weight: 700; color: #0f172a; line-height: 1.35; max-width: 220px; letter-spacing: -0.2px; }
    .header-rule { height: 3px; border-radius: 99px; background: linear-gradient(90deg, ${theme.primary}, ${theme.border}); margin-bottom: 18px; }
    .bill-to-title { color: ${theme.primary}; font-size: 15px; font-weight: 700; margin-bottom: 4px; }
    .client-name { font-size: 18px; font-weight: 800; color: #0f172a; margin-bottom: 3px; }
    .client-meta { font-size: 12px; color: #334155; line-height: 1.5; }
    .invoice-heading { text-align: right; font-size: 34px; font-weight: 900; color: ${theme.dark}; letter-spacing: -0.5px; line-height: 1; margin-bottom: 8px; }
    .paid-pill { display: inline-block; margin-left: 8px; vertical-align: 7px; background: #15803d; color: #fff; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; }
    .service-tag { display: inline-block; float: right; clear: both; background: ${theme.soft}; color: ${theme.dark}; border: 1px solid ${theme.border}; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; margin-bottom: 8px; }
    .section-title { color: ${theme.dark}; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
    table.sheet { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    table.sheet > tbody > tr > td { border: 1px solid ${theme.border}; padding: 12px 14px; vertical-align: top; width: 50%; background: #fff; }
    table.kv { width: 100%; border-collapse: collapse; }
    table.kv td { border: none; border-bottom: 1px solid #eef2f6; padding: 6px 0; font-size: 12px; vertical-align: top; background: transparent; }
    table.kv tr:last-child td { border-bottom: none; }
    table.kv td:first-child { width: 46%; color: #64748b; font-weight: 600; }
    table.kv td:last-child { color: #0f172a; font-weight: 700; text-align: right; }
    .table-wrap { border-radius: 8px; overflow: hidden; border: 1px solid ${theme.primary}; margin-bottom: 16px; }
    table.data-table { width: 100%; border-collapse: collapse; }
    table.data-table th, table.data-table td { border: 1px solid ${theme.line}; }
    table.data-table thead th { background: ${theme.primary}; color: #ffffff; padding: 10px 12px; font-size: 12px; font-weight: 700; text-align: left; border-color: ${theme.dark}; }
    table.data-table thead th.text-right { text-align: right; }
    table.data-table thead th.text-center { text-align: center; }
    table.data-table tbody td { padding: 10px 12px; font-size: 12px; vertical-align: middle; }
    table.data-table tbody tr:nth-child(even) { background: #f8fafc; }
    .item-desc-title { font-weight: 700; color: #0f172a; font-size: 12.5px; }
    .item-desc-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .summary-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 20px; }
    .thank-you-script { font-size: 36px; font-family: 'Brush Script MT', cursive, sans-serif; color: ${theme.primary}; line-height: 1; transform: rotate(-3deg); display: inline-block; }
    .thank-you-sub { font-size: 12px; font-weight: 600; color: #334155; margin-top: 6px; }
    .totals-card { width: 320px; background: ${theme.soft}; border-radius: 8px; overflow: hidden; border: 1px solid ${theme.border}; }
    table.totals { width: 100%; border-collapse: collapse; }
    table.totals td { padding: 8px 14px; font-size: 12px; font-weight: 600; color: #334155; border-bottom: 1px solid ${theme.line}; }
    table.totals td.r { text-align: right; }
    table.totals tr.grand-total td { background: ${theme.primary}; color: #ffffff; font-size: 15px; font-weight: 800; border-bottom: none; padding: 10px 14px; }
    .notes-box { font-size: 11px; color: #475569; line-height: 1.5; }
    .notes-box ul { margin-left: 14px; margin-top: 2px; }
    .signatory-box { margin-top: 12px; text-align: right; }
    .signatory-title { font-size: 11px; font-weight: 700; color: #0f172a; }
    .sign-script { font-family: 'Brush Script MT', cursive; font-size: 26px; color: #334155; margin: 2px 0; }
    .bottom-banner { background: #0b1329; color: #ffffff; border-radius: 8px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 8px; }
    .brand-left-title { font-size: 15px; font-weight: 800; color: #ffffff; }
    .brand-left-sub { font-size: 8px; letter-spacing: 1.3px; color: #94a3b8; margin-top: 2px; }
    .contact-center { font-size: 11px; color: #cbd5e1; line-height: 1.5; }
    .smarter-right { text-align: right; font-size: 13px; font-weight: 700; color: #ffffff; line-height: 1.25; border-left: 1px solid #334155; padding-left: 16px; }
    .sub-categories-bar { margin-top: 8px; text-align: center; font-size: 9px; color: #64748b; letter-spacing: 0.2px; }
    ${poweredByCss}
    .brand-lockup .brand-kicker { font-size: 10px; font-weight: 700; letter-spacing: 2.2px; color: #475569; margin-top: 5px; }
    .brand-lockup .ayotrix-powered { margin-top: 6px; text-align: left; }
    .brand-lockup .ayotrix-powered-label { font-size: 8px; letter-spacing: 0.12em; margin: 0; line-height: 1; color: #94a3b8; }
    .brand-lockup .ayotrix-powered img { height: 64px; width: auto; display: block; margin: -7px 0 -8px -31px; }
  </style>
</head>
<body style="margin: 0; padding: 0;">
  <div class="no-print" style="max-width: 820px; margin: 12px auto 6px; text-align: right; padding: 0 16px;">
    <button onclick="window.print()" style="background: ${theme.dark}; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 13px; box-shadow: 0 2px 6px rgba(15,23,42,0.16);">Print / Download PDF</button>
  </div>

  <div class="page-container" style="max-width: 820px; margin: 0 auto; padding: 18px 26px; background: #ffffff; box-sizing: border-box;">
    <div class="header-row">
      <div class="brand-lockup">
        <img src="${mkFullLogoB64}" alt="MarketingKart.ai" style="height: 56px; width: auto; object-fit: contain; display: block;" />
        <div class="brand-kicker">${label("brandKicker")}</div>
        <div class="ayotrix-powered"><div class="ayotrix-powered-label">${label("poweredByLabel")}</div><img src="${ayotrixLogoB64}" alt="Ayotrix Infotech" /></div>
      </div>
      <div class="tagline-box">${tagline}</div>
    </div>
    <div class="header-rule"></div>

    <table class="sheet">
      <tr>
        <td>
          <div class="bill-to-title">${label("billToTitle")}</div>
          <div class="client-name">${e(clientName)}</div>
          <div class="client-meta">
            ${companyName ? `<div>${e(companyName)}</div>` : ""}
            ${address ? `<div>${e(address)}</div>` : ""}
            ${cityStatePin ? `<div>${e(cityStatePin)}</div>` : ""}
            ${billPhone ? `<div>${e(billPhone)}</div>` : ""}
            ${customerGst ? `<div><strong>${label("customerGstLabel")}: ${e(customerGst)}</strong></div>` : ""}
          </div>
        </td>
        <td>
          <div class="invoice-heading">${label("invoiceTitle")}${paid ? `<span class="paid-pill">${label("paidWord")}</span>` : ""}</div>
          <div class="service-tag">${servicePill}</div>
          ${metaTable}
        </td>
      </tr>
    </table>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">${label("colHash")}</th>
            <th>${label("colDescription")}</th>
            <th class="text-center" style="width: 60px;">${label("colQty")}</th>
            <th class="text-right" style="width: 130px;">${label("colPrice")}</th>
            <th class="text-right" style="width: 130px;">${label("colAmount")}</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => `
            <tr>
              <td style="color: #64748b; font-weight: 600;">${idx + 1}</td>
              <td>
                <div class="item-desc-title">${e(it.description || "")}</div>
                ${it.subDescription ? `<div class="item-desc-sub">${e(it.subDescription)}</div>` : ""}
              </td>
              <td class="text-center" style="font-weight: 600;">${it.qty || 1}</td>
              <td class="text-right" style="font-weight: 600;">₹ ${money(it.unitPrice)}</td>
              <td class="text-right" style="font-weight: 700; color: #0f172a;">₹ ${money(it.amount)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div class="summary-row">
      <div class="thank-you-wrap">
        <div class="thank-you-script">${thankYouHeading}</div>
        <div class="thank-you-sub">${thankYouText}</div>
      </div>
      <div class="totals-card">
        <table class="totals">
          <tr><td>${label("subtotalLabel")}</td><td class="r">₹ ${money(subTotal)}</td></tr>
          ${gstVal > 0 || gstRate > 0 ? `<tr><td>${label("gstLabel")} (${gstRate}%${invoice.gstInclusive ? ", included" : ""})</td><td class="r">₹ ${money(gstVal)}</td></tr>` : ""}
          <tr class="grand-total"><td>${label("totalLabel")}</td><td class="r">₹ ${money(totalVal)}</td></tr>
        </table>
      </div>
    </div>

    <table class="sheet">
      <tr>
        <td>
          <div class="section-title">${paymentTitle}</div>
          ${paymentTable}
        </td>
        <td>
          <div class="notes-box">
            <div class="section-title">${label("notesTitle")}</div>
            <ul>
              ${String(notesForBill || "").split("\n").filter(Boolean).map((n) => `<li>${e(n)}</li>`).join("")}
            </ul>
            <div class="signatory-box">
              <div class="signatory-title">${label("signatoryTitle")}<br/>${signatoryFor}</div>
              <div class="sign-script">${signatoryName}</div>
              <div style="font-size: 10px; color: #64748b;">${signatoryLabel}</div>
            </div>
          </div>
        </td>
      </tr>
    </table>

    <div class="bottom-banner">
      <div>
        <div style="font-size: 8px; color: #94a3b8; font-weight: 500; margin-bottom: 2px;">${label("brandOfLabel")}</div>
        <div class="brand-left-title">${brandParent}</div>
        <div class="brand-left-sub">${brandSubtext}</div>
        ${String(chrome.companyGstin || "").trim() ? `<div style="margin-top: 6px; font-size: 11px; font-weight: 700; color: #ffffff;">${label("companyGstLabel")}: ${e(chrome.companyGstin)}</div>` : ""}
      </div>
      <div class="contact-center">
        ${brandPhone ? `<div>${brandPhone}</div>` : ""}
        <div>${brandEmail}</div>
        <div>${brandWebsite}</div>
        <div>${brandCity}</div>
      </div>
      <div class="smarter-right">${brandMotto}</div>
    </div>

    <div class="sub-categories-bar">${bottomServicesBar}</div>
  </div>
</body>
</html>`;

    return html;
  } catch (error) {
    error.message = "Error rendering invoice: " + error.message;
    throw error;
  }
}

function sendHtml(res, html) {
  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", "no-store");
  return res.send(html);
}

exports.getInvoiceHTML = async (req, res) => {
  try {
    const invoiceId = req.query.invoiceId || req.params.invoiceId;
    const invoice = await invoiceModel
      .findById(invoiceId)
      .populate("userId")
      .populate("businessId")
      .populate("adsTypeId", "title");
    if (!invoice) return res.status(404).send("Invoice not found");
    return sendHtml(res, await renderStoredInvoice(invoice));
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

// Same MarketingKart page, with sample lines, so an admin can see a template before it is used.
exports.previewInvoiceTemplate = async (req, res) => {
  try {
    const Template = require("../models/invoiceTemplate.model.js");
    const template = req.query.templateId
      ? await Template.findById(req.query.templateId)
      : await resolveTemplate({ service: "META_ADS" });
    if (!template) return res.status(404).send("Template not found");
    const sample = {
      _preview: true,
      service: template.service || "META_ADS",
      templateId: template._id,
      status: "PENDING",
      invoiceNumber: "MKAI/PREVIEW",
      clientName: "Sample customer",
      companyName: "Sample business",
      addressLine1: "Indore, Madhya Pradesh",
      cityStatePin: "India",
      gstin: "29ABCDE1234F1Z5",
      companyGstin: String(template.companyGstin || "").trim() || "23AAAAA0000A1Z5",
      items: [{ description: "Meta Ads", subDescription: "Sample line. Real bills use the customer's order.", qty: 1, unitPrice: 1000, amount: 1000 }],
      subTotal: 1000,
      gstAmount: "180",
      gstRate: 18,
      totalAmount: 1180,
      createdAt: new Date(),
    };
    return sendHtml(res, await renderStoredInvoice(sample));
  } catch (error) {
    return res.status(500).send(error.message);
  }
};

