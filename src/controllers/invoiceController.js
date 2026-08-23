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
      .populate("businessId", "businessName")
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
