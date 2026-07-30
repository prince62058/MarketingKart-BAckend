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

    const GST = (Amount * companyData?.gstFee) / 100;
    const PlatformFee = (Amount * companyData?.serviceFee) / 100;
    let amount = PlatformFee + Amount;
    const PaymentGetwayFee = (amount * companyData?.paymentGetWayFee) / 100;
    const totalAmount = amount + PaymentGetwayFee;
    // console.log(addwithgst, "addwithgst");
    console.log(fbBudget, "fbBudget");
    console.log(inBudget, "inBudget");
    console.log(gBudget, "gBudget");
    const date = new Date().toISOString().split("T")[0];
    const invoiceNumber = await generateInvoiceNumber();

    // HTML Content
    const htmlContent = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Invoice</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 10px;
            padding: 0;
            background-color: #fff;
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100vw;
          }
          .label-container {
            display: flex;
            border: 3px solid black;
            padding: 10px;
            width: 90vw;
            max-width: 1200px;
            height: auto;
          }
          .underline{
            width:50%;
            border: 1px solid black;
          }
          .left-section {
            width: 60%;
            padding: 10px;
            border-right: 3px solid black;
          }
          .right-section {
            width: 40%;
            padding: 10px;
          }
          .cod-section {
            font-size: 20px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          }
          .cod-section strong {
      display: block;
      text-decoration: none;
      border: none !important;
      line-height: 1;
      margin: 0;
      padding: 0;
    }

          .product-details {
            width: 90vw;
            max-width: 1200px;
            margin-top: 10px;
            border: 3px solid black;
            padding: 10px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            border: 2px solid black;
            padding: 8px;
            text-align: center;
          }
          th {
            font-weight: bold;
            background-color: #f2f2f2;
          }
          .invoice-container {
            width: 90vw;
            max-width: 1200px;
            border: 3px solid black;
            padding: 15px;
            margin-top: 10px;
          }
          .invoice-title {
            text-align: center;
            font-size: 20px;
            font-weight: bold;
            text-transform: uppercase;
            border-bottom: 2px solid black;
            padding-bottom: 5px;
            background-color: #f2f2f2;
          }
          .invoice-details {
            display: flex;
            justify-content: flex-start;
            padding: 10px 0;
            font-size: 14px;
            border: 2px solid black;
          }
          .seller-info {
            width: 48%;
            padding: 10px;
          }
        </style>
      </head>
      <body>
        <div class="label-container">
          <div class="left-section">
            <div class="customer-address">
              <p><strong>${companyData?.name || "N/A"}</strong></p>
              <p>${companyData?.address || "N/A"}</p>
              <p>Email: ${companyData?.email || "N/A"}</p>
              <p>Phone: ${companyData?.phone || "N/A"}</p>
            </div>
            <hr style="border: 3px solid black" />
            <div class="return-address">
               ${adata}
            </div>
          </div>
          <div class="right-section">
            <div class="cod-section">
              <img src="${
                companyData?.logo || ""
              }" alt="QR Code" style="width: 200px; height: 200px; margin: 0px auto" onerror="this.style.display='none'" />
              <div style="margin-top: 5px; border: none; padding: 0;">
                <strong>INV : ${invoiceNumber}</strong>
              </div>
              <div>Date: ${date}</div>
              <div style="font-size:1drem;">TXIDs: ${transactionId || "0000000"}</div>
            </div>
          </div>
        </div>
        <div class="product-details">
          <h1 style="font-weight: bold; font-size: 20px">Product Details</h1>
          <table>
            <tr>
              <th>Ads Name</th>
              <th>Ads Type</th>
              <th>Insta Budget</th>
              <th>Facebook Budget</th>
              <th>Google Budget</th>
            </tr>
            <tr>
              <td>${ins?.title || "N/A"}</td>
              <td>${addType || "N/A"}</td>
              <td>${inBudget}</td>
              <td>${fbBudget}</td>
              <td>${gBudget}</td>
            </tr>
          </table>
        </div>
        <div class="invoice-container">
          <h2 class="invoice-title">TAX INVOICE</h2>
          <div class="invoice-details">
            <div class="seller-info">
              <p><strong>Ads Amount:</strong> ${Amount.toFixed(2)} (Inc. Gst: 18%)</p>
            
              <p><strong>Platform Fee:</strong> ${PlatformFee.toFixed(2)} (${
                companyData.serviceFee || "20"
              }% platform charges.</p>             <div class="underline"> </div>
              <p><strong>Sub Total:</strong> ${amount.toFixed(2)}</p>
              <p><strong>Payment Gateway Fee:</strong> ${PaymentGetwayFee.toFixed(
                2
              )} (${companyData.paymentGetWayFee || "2"}%)</p>

                 <div class="underline"> </div>
              <p>Total Amount: <strong>${totalAmount.toFixed(2)}</strong></p>
            </div>
          </div>
        </div>
      </body>
    </html>
            `;

    // Generate PDF
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
      timeout: 60000, // Increase timeout to 60 seconds
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "load" });
    const pdfBuffer = await page.pdf({ format: "A4" });
    await browser.close();

    // Upload PDF to Cloudinary
    const uploadedFile = await uploadBuffer(pdfBuffer, {
      folder: "LEADKART/INVOICES",
      resourceType: "raw",
      publicId: `invoice-${Date.now()}`,
    });
    const invoiceUrl = uploadedFile.secure_url;

    // Send Email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: business?.businessEmail,
      subject: "Your Invoice",
      text: "Please find the attached invoice.",
      attachments: [
        {
          filename: "Invoice.pdf",
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    };

    await transporter.sendMail(mailOptions);

    console.log("Invoice sent successfully");

    const data = await new invoiceModel({
      addAmount: parseInt(Amount),
      commisionAmount: PlatformFee,
      gstAmount: GST,
      paymentGetWayFee: PaymentGetwayFee,
      userId: business?.userId,
      businessId: business.businessId,
      adTyId: advertismentType?._id,
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
    const invoiceId = req.query.invoiceId;
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
