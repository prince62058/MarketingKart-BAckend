const whatsappTemplateService = require("../services/whatsappTemplateService");
const whatsappCloudApiService = require("../services/whatsappCloudApiService");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key",
});

/**
 * Helper: Generate sample/example values for Meta template variables.
 * Meta REQUIRES example values for all {{1}}, {{2}} etc. variables during template creation.
 * Without these, templates get REJECTED by Meta review.
 */
const generateExampleValues = (text) => {
  const matches = text ? text.match(/\{\{(\d+)\}\}/g) : null;
  if (!matches || matches.length === 0) return [];
  
  // Deduplicate and sort by number
  const uniqueVars = [...new Set(matches)].sort((a, b) => {
    return parseInt(a.replace(/\D/g, "")) - parseInt(b.replace(/\D/g, ""));
  });

  // Generate meaningful sample values for Meta reviewers
  const sampleValues = [
    "Customer",      // {{1}} - typically a name
    "12345",         // {{2}} - typically an order/ID
    "50%",           // {{3}} - typically an offer/discount
    "tomorrow",      // {{4}} - typically a date
    "LeadKart",      // {{5}} - typically a brand
    "www.example.com", // {{6}} - typically a link
    "10:00 AM",      // {{7}} - typically a time
    "New Delhi",     // {{8}} - typically a location
  ];

  return uniqueVars.map((_, idx) => sampleValues[idx] || `Value${idx + 1}`);
};

exports.createTemplate = async (req, res) => {
  try {
    const { name, category, language, bodyText, businessId, headerType, headerText, headerMediaUrl, footerText, buttons, marketingType, exampleBodyValues } = req.body;

    if (!name || !category || !bodyText) {
      return res.status(400).json({ success: false, message: "name, category, bodyText are required" });
    }

    // Validate template name format (Meta requires lowercase + underscores only)
    const cleanName = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!cleanName || cleanName.length < 1) {
      return res.status(400).json({ success: false, message: "Template name must contain at least one valid character (lowercase letters, numbers, underscores only)" });
    }

    // --- Subscription & Limit Enforcement (Bypass for ADMIN) ---
    if (req.user.userType !== "ADMIN") {
      const WhatsAppSubscription = require("../models/whatsappSubscriptionModel");
      const whatsappTemplateModel = require("../models/whatsappTemplateModel");
      
      const activeSub = await WhatsAppSubscription.findOne({
        userId: req.user._id,
        status: "ACTIVE",
        endDate: { $gt: new Date() }
      }).populate("planId");

      if (!activeSub || !activeSub.planId) {
        return res.status(403).json({
          success: false,
          message: "No active WhatsApp plan. Please purchase a plan to create templates."
        });
      }

      const plan = activeSub.planId;

      // Check Template Limit (per billing cycle)
      const templatesThisCycle = await whatsappTemplateModel.countDocuments({
        createdBy: req.user._id,
        createdAt: { $gte: activeSub.startDate, $lte: activeSub.endDate }
      });

      if (templatesThisCycle >= plan.templateLimit) {
        return res.status(403).json({
          success: false,
          message: `Plan limit exceeded: You have reached your limit of ${plan.templateLimit} templates for this billing cycle.`
        });
      }
    }
    // ----------------------------------------

    // Build Meta-compliant components payload
    const components = [];

    // ===== HEADER COMPONENT =====
    if (headerType && headerType !== "NONE") {
      let headerComponent = { type: "HEADER", format: headerType };
      
      if (headerType === "TEXT") {
        headerComponent.text = headerText || "";
        // Add example for TEXT header if it contains variables
        const headerExamples = generateExampleValues(headerText);
        if (headerExamples.length > 0) {
          headerComponent.example = { header_text: headerExamples };
        }
      } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType)) {
        // For media headers, Meta requires example.header_handle with a media handle
        // The headerMediaUrl should be a publicly accessible URL
        if (headerMediaUrl) {
          headerComponent.example = { header_handle: [headerMediaUrl] };
        }
      }
      
      components.push(headerComponent);
    }

    // ===== BODY COMPONENT (CRITICAL: Must include example values) =====
    const bodyComponent = {
      type: "BODY",
      text: bodyText,
    };
    
    // Meta REQUIRES example values for ALL body variables — this is the #1 rejection cause
    const bodyExamples = exampleBodyValues && exampleBodyValues.length > 0
      ? exampleBodyValues
      : generateExampleValues(bodyText);
    
    if (bodyExamples.length > 0) {
      bodyComponent.example = { body_text: [bodyExamples] };
    }
    components.push(bodyComponent);

    // ===== FOOTER COMPONENT =====
    if (footerText && footerText.trim()) {
      components.push({
        type: "FOOTER",
        text: footerText.trim(),
      });
    }

    // ===== BUTTONS COMPONENT =====
    if (buttons && buttons.length > 0) {
      const metaButtons = buttons.map(btn => {
        if (btn.type === "QUICK_REPLY") return { type: "QUICK_REPLY", text: btn.text };
        if (btn.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: btn.text, phone_number: btn.phoneNumber };
        if (btn.type === "URL") {
          const urlBtn = { type: "URL", text: btn.text, url: btn.url };
          // If URL contains a variable like {{1}}, add example
          if (btn.url && btn.url.includes("{{")) {
            urlBtn.example = [btn.url.replace(/\{\{\d+\}\}/g, "https://www.example.com")];
          }
          return urlBtn;
        }
      }).filter(Boolean);

      if (metaButtons.length > 0) {
        components.push({ type: "BUTTONS", buttons: metaButtons });
      }
    }

    // Fetch User's WhatsApp Credentials dynamically
    const account = await whatsappAccountModel.findOne({ userId: req.user._id });
    if (!account || account.status !== "CONNECTED") {
      return res.status(403).json({ success: false, message: "WhatsApp Account not connected. Please connect your META WhatsApp account to create templates." });
    }

    // Upload to Meta for approval
    let metaTemplateId = null;
    let metaStatus = "PENDING";
    let metaUploadError = null;
    try {
      const metaResult = await whatsappCloudApiService.uploadTemplateToMeta({
        name: cleanName,
        category,
        language: language || "en_US",
        components,
      }, { accessToken: account.accessToken, wabaId: account.wabaId });
      metaTemplateId = metaResult?.id || null;
      metaStatus = metaResult?.status || "PENDING";
      console.log(`[Template] Meta upload SUCCESS: id=${metaTemplateId}, status=${metaStatus}`);
    } catch (metaErr) {
      metaUploadError = metaErr?.metaErrorDetails?.error_user_msg || metaErr?.message || "Meta upload failed";
      console.warn("[Template] Meta upload failed:", metaUploadError);
      // Don't return error here — save template locally with rejection info
      metaStatus = "REJECTED";
    }

    const template = await whatsappTemplateService.createTemplate({
      name: cleanName,
      category,
      language: language || "en_US",
      bodyText,
      headerType: headerType || "NONE",
      headerText: headerText || "",
      headerMediaUrl: headerMediaUrl || "",
      footerText: footerText || "",
      buttons: buttons || [],
      marketingType: marketingType || "CUSTOM",
      components,
      metaTemplateId,
      status: metaStatus,
      businessId: businessId || null,
      createdBy: req.user._id,
    });

    // If Meta rejected, still return success (saved locally) but include warning
    if (metaUploadError) {
      return res.status(201).json({ 
        success: true, 
        message: `Template saved but Meta submission failed: ${metaUploadError}`, 
        metaError: metaUploadError,
        data: template 
      });
    }

    return res.status(201).json({ success: true, message: "Template submitted to Meta for review successfully!", data: template });
  } catch (error) {
    console.error("[Template] createTemplate error:", error.message);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Template name already exists" });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllTemplates = async (req, res) => {
  try {
    const { page = 1, search = "", status = "", businessId } = req.query;
    const result = await whatsappTemplateService.getAllTemplates({
      page: parseInt(page),
      search,
      status,
      businessId,
      createdBy: req.user._id,
      isAdmin: req.user.userType === "ADMIN",
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTemplateById = async (req, res) => {
  try {
    const template = await whatsappTemplateService.getTemplateById(req.params.templateId, {
      createdBy: req.user._id,
      isAdmin: req.user.userType === "ADMIN",
    });
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    return res.status(200).json({ success: true, data: template });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const template = await whatsappTemplateService.updateTemplate(
      req.params.templateId,
      req.body,
      {
        createdBy: req.user._id,
        isAdmin: req.user.userType === "ADMIN",
      }
    );
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    return res.status(200).json({ success: true, message: "Template updated", data: template });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.syncTemplates = async (req, res) => {
  try {
    const account = await whatsappAccountModel.findOne({ userId: req.user._id });
    if (!account || account.status !== "CONNECTED") {
      return res.status(403).json({ success: false, message: "WhatsApp Account not connected." });
    }

    const updatedCount = await whatsappTemplateService.syncFromMeta(
      { accessToken: account.accessToken, wabaId: account.wabaId },
      { createdBy: req.user._id }
    );
    return res.status(200).json({
      success: true,
      message: `Synced from Meta — ${updatedCount} template(s) updated`,
      updatedCount,
    });
  } catch (error) {
    console.error("[Template] syncTemplates error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.aiGenerateTemplate = async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, message: "Prompt is required" });
    }

    const sysPrompt = `You are an expert WhatsApp marketing copywriter who creates Meta-approved templates.
IMPORTANT: Follow Meta's WhatsApp Business API template guidelines strictly.

Rules for Meta approval:
1. Template names: ONLY lowercase letters, numbers, and underscores. No spaces.
2. Body text: Max 1024 characters. Be professional, not spammy.
3. Variables MUST be sequential: {{1}}, {{2}}, {{3}} etc. Never skip a number.
4. Do NOT start the body text with a variable. Start with a greeting or text.
5. Avoid spam-trigger words like "FREE!!!", "CLICK NOW", "LIMITED TIME". Keep it professional.
6. Header text max 60 chars. Footer text max 60 chars. Button text max 20 chars.
7. Use proper grammar and punctuation.

Generate a WhatsApp template response in JSON format.
The JSON must have the following keys:
- name: string (lowercase letters, numbers and underscores ONLY, e.g. "diwali_sale_offer")
- category: string ("MARKETING" or "UTILITY")
- headerType: string ("NONE", "TEXT")
- headerText: string (Only if headerType is TEXT. Max 60 chars. Clear and professional.)
- bodyText: string (The main message. Use formatting *bold*, _italic_. Max 1024 chars. Must NOT start with a variable.)
- footerText: string (Optional short footer like "Reply STOP to opt out". Max 60 chars)
- buttons: array of objects. Each object:
   - type: ("QUICK_REPLY", "PHONE_NUMBER", "URL")
   - text: (Button label, max 20 chars)
   - phoneNumber: (Required if type is PHONE_NUMBER. E.g. "+919876543210")
   - url: (Required if type is URL. Must be full HTTPS URL, no URL shorteners)
   Max buttons: 3.
- exampleBodyValues: array of strings — sample values for each {{1}}, {{2}} etc. in bodyText. 
   These are REQUIRED by Meta for template review. E.g. if body has {{1}} and {{2}}, provide ["Rahul", "50%"].

User Prompt: ${prompt}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Cost efficient model for generation
      messages: [{ role: "system", content: sysPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const content = response.choices[0].message.content;
    const generatedTemplate = JSON.parse(content);

    return res.status(200).json({ success: true, data: generatedTemplate });
  } catch (error) {
    console.error("[Template] aiGenerateTemplate error:", error?.message || error);
    return res.status(500).json({ success: false, message: "AI Generation failed: " + error.message });
  }
};

/**
 * Upload media file (image/video/document) for WhatsApp template header.
 * File is uploaded to S3 bucket via multer middleware.
 * Returns the public URL of the uploaded file.
 */
exports.uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const fileUrl = req.file.location; // multer-s3 puts the public URL here
    const fileType = req.file.mimetype;
    const fileName = req.file.originalname;
    const fileSize = req.file.size;

    console.log(`[Template] Media uploaded: ${fileName} (${fileType}, ${fileSize} bytes) -> ${fileUrl}`);

    return res.status(200).json({
      success: true,
      message: "Media uploaded successfully",
      data: {
        url: fileUrl,
        fileName,
        fileType,
        fileSize,
      },
    });
  } catch (error) {
    console.error("[Template] uploadMedia error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

