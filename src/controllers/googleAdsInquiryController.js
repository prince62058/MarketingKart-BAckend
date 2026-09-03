const GoogleAdsInquiry = require("../models/googleAdsInquiryModel");
const nodemailer = require("nodemailer");

// Nodemailer Transporter
const getTransporter = () => {
  const user = process.env.EMAIL_USER || "ayotrix1@gmail.com";
  const pass = process.env.EMAIL_PASS || "ijewaofeggqbwmmm";

  return {
    transporter: nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    }),
    fromUser: user,
  };
};

/**
 * Send email alerts when a new Google Ads inquiry is created
 */
async function sendInquiryEmails(inquiry) {
  try {
    const { transporter, fromUser } = getTransporter();
    const adminEmail = process.env.ADMIN_EMAIL || fromUser;

    const formattedDate = new Date(inquiry.createdAt || Date.now()).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });

    // 1. Admin Alert Email
    const adminMailHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>New Google Ads Inquiry</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #F8FAFC; padding: 25px 10px;">
        <tr>
          <td align="center">
            <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #FFFFFF; border-radius: 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #E2E8F0;">
              <tr>
                <td style="background: linear-gradient(135deg, #1A73E8 0%, #4285F4 60%, #34A853 100%); padding: 30px; text-align: center;">
                  <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 800;">🚀 New Google Ads Inquiry</h1>
                  <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.95); font-size: 14px;">High-intent customer inquiry received from MarketingKart</p>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px 25px;">
                  <div style="background: #F1F5F9; border-radius: 12px; padding: 18px; margin-bottom: 24px; border-left: 5px solid #1A73E8;">
                    <p style="margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;">${inquiry.businessName}</p>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748B;">Submitted on ${formattedDate}</p>
                  </div>

                  <table role="presentation" style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr style="border-bottom: 1px solid #F1F5F9;">
                      <td style="padding: 10px 0; color: #64748B; width: 38%;"><strong>Contact Person</strong></td>
                      <td style="padding: 10px 0; color: #0F172A; font-weight: 600;">${inquiry.contactPerson}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #F1F5F9;">
                      <td style="padding: 10px 0; color: #64748B;"><strong>Phone Number</strong></td>
                      <td style="padding: 10px 0; color: #1A73E8; font-weight: 700;">
                        <a href="tel:${inquiry.phone}" style="color: #1A73E8; text-decoration: none;">${inquiry.phone}</a>
                      </td>
                    </tr>
                    <tr style="border-bottom: 1px solid #F1F5F9;">
                      <td style="padding: 10px 0; color: #64748B;"><strong>Email Address</strong></td>
                      <td style="padding: 10px 0; color: #0F172A;">${inquiry.email || "Not provided"}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #F1F5F9;">
                      <td style="padding: 10px 0; color: #64748B;"><strong>Monthly Budget</strong></td>
                      <td style="padding: 10px 0; color: #16A34A; font-weight: 700;">${inquiry.monthlyBudget}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #F1F5F9;">
                      <td style="padding: 10px 0; color: #64748B;"><strong>Primary Goal</strong></td>
                      <td style="padding: 10px 0; color: #D97706; font-weight: 600;">${inquiry.campaignGoal}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #F1F5F9;">
                      <td style="padding: 10px 0; color: #64748B;"><strong>Target Location</strong></td>
                      <td style="padding: 10px 0; color: #0F172A;">${inquiry.targetLocation || "Pan India"}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid #F1F5F9;">
                      <td style="padding: 10px 0; color: #64748B;"><strong>Website / URL</strong></td>
                      <td style="padding: 10px 0; color: #0F172A;">
                        ${inquiry.websiteUrl ? `<a href="${inquiry.websiteUrl}" target="_blank" style="color: #1A73E8;">${inquiry.websiteUrl}</a>` : "Not provided"}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748B; vertical-align: top;"><strong>Notes / Message</strong></td>
                      <td style="padding: 10px 0; color: #334155; line-height: 1.5;">${inquiry.notes || "No special notes provided."}</td>
                    </tr>
                  </table>

                  <div style="margin-top: 30px; text-align: center;">
                    <a href="https://wa.me/${inquiry.phone.replace(/[^0-9]/g, '')}" style="background-color: #25D366; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; display: inline-block; margin-right: 10px;">
                      💬 Chat on WhatsApp
                    </a>
                    <a href="tel:${inquiry.phone}" style="background-color: #1A73E8; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 700; display: inline-block;">
                      📞 Call Now
                    </a>
                  </div>
                </td>
              </tr>
              <tr>
                <td style="background-color: #FAFAFA; padding: 18px 25px; text-align: center; border-top: 1px solid #F1F5F9; color: #94A3B8; font-size: 12px;">
                  MarketingKart.ai • Automated Google Ads Lead Generation System
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

    await transporter.sendMail({
      from: `"MarketingKart.ai Leads" <${fromUser}>`,
      to: adminEmail,
      subject: `🚀 New Google Ads Inquiry: ${inquiry.businessName} (${inquiry.phone})`,
      html: adminMailHtml,
    });
    console.log("Admin notification email sent for Google Ads inquiry:", inquiry._id);

    // 2. Client Confirmation Email (if valid email provided)
    if (inquiry.email && inquiry.email.includes("@")) {
      const clientMailHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Google Ads Inquiry Received</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #F8FAFC; padding: 25px 10px;">
          <tr>
            <td align="center">
              <table role="presentation" style="width: 100%; max-width: 580px; border-collapse: collapse; background-color: #FFFFFF; border-radius: 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #E2E8F0;">
                <tr>
                  <td style="background: linear-gradient(135deg, #1A73E8 0%, #4285F4 100%); padding: 32px 25px; text-align: center;">
                    <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 800;">MarketingKart<span style="opacity: 0.9;">.ai</span></h1>
                    <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">Google Ads Campaign Inquiry Received</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 30px 25px;">
                    <h2 style="margin: 0 0 12px 0; color: #0F172A; font-size: 20px;">Hello ${inquiry.contactPerson || inquiry.businessName},</h2>
                    <p style="margin: 0 0 20px 0; color: #64748B; font-size: 14px; line-height: 22px;">
                      Thank you for your interest in scaling your business with <strong>Google Ads</strong> through MarketingKart.ai! We have successfully received your inquiry.
                    </p>

                    <div style="background-color: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 18px; margin-bottom: 24px;">
                      <p style="margin: 0 0 10px 0; font-weight: 700; color: #1E40AF; font-size: 14px;">Inquiry Summary:</p>
                      <ul style="margin: 0; padding-left: 20px; color: #1E3A8A; font-size: 13.5px; line-height: 20px;">
                        <li><strong>Business:</strong> ${inquiry.businessName}</li>
                        <li><strong>Campaign Goal:</strong> ${inquiry.campaignGoal}</li>
                        <li><strong>Selected Monthly Budget:</strong> ${inquiry.monthlyBudget}</li>
                        <li><strong>Target Location:</strong> ${inquiry.targetLocation || "Pan India"}</li>
                      </ul>
                    </div>

                    <div style="background-color: #FEF3C7; border: 1px solid #FDE68A; border-radius: 12px; padding: 14px 18px; margin-bottom: 24px;">
                      <p style="margin: 0; color: #92400E; font-size: 13px; line-height: 18px;">
                        📞 <strong>What happens next?</strong> A dedicated Google Ads certified campaign strategist will review your business and reach out to you via Phone/WhatsApp within <strong>24 business hours</strong>.
                      </p>
                    </div>

                    <p style="margin: 0; color: #64748B; font-size: 13px; line-height: 20px;">
                      Have questions right now? You can also reach our support team directly in the MarketingKart mobile app anytime.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #FAFAFA; padding: 18px 25px; text-align: center; border-top: 1px solid #F1F5F9; color: #94A3B8; font-size: 12px;">
                    © ${new Date().getFullYear()} MarketingKart.ai — All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
      `;

      await transporter.sendMail({
        from: `"MarketingKart.ai" <${fromUser}>`,
        to: inquiry.email,
        subject: `🎯 We Received Your Google Ads Inquiry — MarketingKart.ai`,
        html: clientMailHtml,
      });
      console.log("Client confirmation email sent to:", inquiry.email);
    }
  } catch (err) {
    console.error("Error sending Google Ads inquiry emails:", err.message);
  }
}

// 1. Create a new Google Ads inquiry
exports.createGoogleAdsInquiry = async (req, res) => {
  try {
    const {
      businessName,
      contactPerson,
      phone,
      email,
      websiteUrl,
      campaignGoal,
      monthlyBudget,
      targetLocation,
      notes,
      userId,
      businessId,
    } = req.body;

    if (!businessName || !phone) {
      return res.status(400).json({
        success: false,
        message: "Business name and phone number are required.",
      });
    }

    const newInquiry = new GoogleAdsInquiry({
      businessName: businessName.trim(),
      contactPerson: (contactPerson || businessName).trim(),
      phone: phone.trim(),
      email: (email || "").trim(),
      websiteUrl: (websiteUrl || "").trim(),
      campaignGoal: campaignGoal || "Lead Generation",
      monthlyBudget: monthlyBudget || "₹10,000 - ₹25,000",
      targetLocation: (targetLocation || "Pan India").trim(),
      notes: (notes || "").trim(),
      userId: userId || null,
      businessId: businessId || null,
    });

    await newInquiry.save();

    // Trigger emails asynchronously (does not block response)
    sendInquiryEmails(newInquiry).catch((err) => {
      console.error("Background email sending error:", err);
    });

    res.status(201).json({
      success: true,
      message: "Google Ads inquiry submitted successfully! Our expert will contact you soon.",
      data: newInquiry,
    });
  } catch (error) {
    console.error("Error creating Google Ads inquiry:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to submit Google Ads inquiry.",
    });
  }
};

// 2. Get all Google Ads inquiries for Admin
exports.getAllGoogleAdsInquiries = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", status = "" } = req.query;

    const query = {};

    if (status && status !== "ALL") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { businessName: { $regex: search, $options: "i" } },
        { contactPerson: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { campaignGoal: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [inquiries, total] = await Promise.all([
      GoogleAdsInquiry.find(query)
        .populate("userId", "name email phone")
        .populate("businessId", "businessName businessEmail businessContact")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      GoogleAdsInquiry.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      message: "Google Ads inquiries fetched successfully",
      data: inquiries,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error("Error fetching Google Ads inquiries:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 3. Update Google Ads inquiry status
exports.updateGoogleAdsInquiryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, assignedStaff } = req.body;

    const updateData = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (assignedStaff !== undefined) updateData.assignedStaff = assignedStaff;

    const updated = await GoogleAdsInquiry.findByIdAndUpdate(id, updateData, { new: true });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Inquiry not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Inquiry updated successfully",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 4. Delete Google Ads inquiry
exports.deleteGoogleAdsInquiry = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await GoogleAdsInquiry.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Inquiry not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Inquiry deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
