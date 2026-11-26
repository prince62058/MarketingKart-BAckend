const axios = require("axios");
const crypto = require("crypto");
const mongoose = require("mongoose");
const webhookModel = require("../models/webhookModel");
const VERIFY_TOKEN = process.env.META_LEAD_WEBHOOK_VERIFY_TOKEN || "da21e0d80f1d406e99ff7b518fd3936b";
const businessModel = require("../models/businessModel");
const leadModel = require("../models/leadModel");
const leadFormModel = require("../models/leadFormsModel");
const adsetModel = require("../models/internalCampiagnModel");
const addDetailsModel = require("../models/adsDetailModel");
const leadHistoryChangeStatusModel = require("../models/leadHistoryChangeStatusModel");
const cron = require("node-cron");
const pinnedLeadsModel = require("../models/pinnedLeadsModel");
const whatsappConversationModel = require("../models/whatsappConversationModel");
const whatsappAccountModel = require("../models/whatsappAccountModel");
const whatsappMessageModel = require("../models/whatsappMessageModel");
const whatsappCampaignModel = require("../models/whatsappCampaignModel");
const whatsappTemplateModel = require("../models/whatsappTemplateModel");
const Notification = require("../models/notificationModel");
const User = require("../models/userModel");
const { sendNotificationToMultipleToken } = require("./notificationController");
const {
  sendLeadNotification,
  sendTemplateStatusNotification,
  sendWhatsAppInboundNotification,
  sendWhatsAppDeliveryNotification,
} = require("../helpers/appNotificationHelper");
const { syncLeadsForBusiness } = require("../services/leadSyncService");
const whatsappBotService = require("../services/whatsappBotService");
const whatsappAccountHealthService = require("../services/whatsappAccountHealthService");
const whatsappConversionService = require("../services/whatsappConversionService");
const whatsappFlowService = require("../services/whatsappFlowService");
const whatsappBilling = require("../services/whatsappBillingService");
const chatbotAccess = require("../services/whatsappChatbotAccess");

const getPhoneVariants = (rawPhone) => {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (!digits) return [];

  const variants = new Set([digits, `+${digits}`]);

  if (digits.length === 10) {
    variants.add(`91${digits}`);
    variants.add(`+91${digits}`);
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    const local = digits.slice(2);
    variants.add(local);
    variants.add(`+${local}`);
  }

  return Array.from(variants);
};
const fetchAndProcessLeadDetails = async (data, PAGE_ACCESS_TOKEN) => {
  // A Page token that has since expired is the usual reason a lead lands in the
  // app with no name and no number, so fall back to the system user token that
  // every other Meta call here already uses.
  const token = PAGE_ACCESS_TOKEN || process.env.systemUserAccessToken;
  const url = `https://graph.facebook.com/v22.0/${data?.leadgenId}?access_token=${token}`;
  try {
    const response = await axios.get(url);
    const leadDetails = response?.data;
    const extractedData = {};

    leadDetails?.field_data.forEach((item) => {
      extractedData[item.name] = item.values[0];
    });
    const phone =
      extractedData.phone_number ||
      extractedData.phone ||
      extractedData.mobile_number ||
      extractedData.mobile ||
      extractedData.work_phone ||
      null;
    const fullName =
      extractedData.full_name ||
      extractedData["full name"] ||
      extractedData.name ||
      null;
    await leadModel.findByIdAndUpdate(
      { _id: data?._id },
      {
        $set: {
          userContactNumber: phone,
          name: fullName,
          email: extractedData?.email || null,
          whatsappNumber:
            extractedData?.whatsapp_number ||
            extractedData?.whatsapp ||
            phone,
        },
      },
      { new: true }
    );
    return { name: fullName, phone };
  } catch (error) {
    console.error("Error fetching lead details:", error);
    return { name: null, phone: null };
  }
};

exports.getWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
};

// Endpoint to handle webhook events
exports.postWebhook = async (req, res) => {
  const payload = req.body;

  if (payload.entry) {
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const value = change.value;
        if (value.leadgen_id) {
          const leadgenId = value.leadgen_id;
          const pageId = value.page_id;
          const adId = value.ad_id;

          let business = await businessModel.findOne({ pageId: pageId });
          const adsetIdFromWebhook = value.adset_id;
          const formId = value.form_id;
          let campaign = await adsetModel.findOne({
            $or: [
              { mainAdId: adId },
              { metaAdId: adId },
              ...(adsetIdFromWebhook
                ? [{ facebookAdSetId: adsetIdFromWebhook }, { instaAdSetId: adsetIdFromWebhook }]
                : []),
            ],
          });

          // Fall back to the form we created for the campaign. An ad rebuilt
          // after a reset carries an ad id we have never stored, so matching on
          // the ad alone threw those leads away — even though the advertiser
          // paid for exactly that form.
          let leadForm = null;
          if (formId) {
            leadForm = await leadFormModel
              .findOne({ formId })
              .select("internalCampiagnId businessId");
          }
          if (!campaign && leadForm?.internalCampiagnId) {
            campaign = await adsetModel.findById(leadForm.internalCampiagnId);
          }
          if (!business && leadForm?.businessId) {
            business = await businessModel.findById(leadForm.businessId);
          }

          await webhookModel.create({ leadgenId: leadgenId });

          // Only create app leads for Meta ads that are linked in MarketingKart.
          // Unlinked / historical Instant Form ads must not fill the Leads tab.
          if (!business || !campaign) {
            console.warn(
              `[Webhook] leadgen ${leadgenId} ignored — no linked ${!business ? "business" : "campaign"} for page ${pageId}, ad ${adId}, form ${formId}`,
            );
            continue;
          }

          let find = await leadModel.findOne({ leadgenId: leadgenId });

          if (!find) {
            let data = await leadModel.create({
              businessId: business?._id,
              internalCampiagnId: campaign?._id,
              adsetId: campaign?.facebookAdSetId || campaign?.instaAdSetId || campaign?.metaAdsetId,
              adId: adId,
              pageId: pageId,
              leadgenId: leadgenId,
              formId: value?.form_id,
              createdTime: value?.created_time,
              leadSource: "META",
              leadStatus: "NEW",
            });
            const details = await fetchAndProcessLeadDetails(data, business?.pageAccessToken);

            if (business?.userId) {
              await pinnedLeadsModel.create({
                userId: business.userId,
                leadId: data._id,
              });

              // One push per lead, to the business owner. A batch of five leads
              // is five alerts, so none of them is hidden inside a count.
              await sendLeadNotification({
                userId: business.userId,
                businessId: business._id,
                campaignId: campaign?._id,
                campaignName: campaign?.title,
                leadName: details?.name,
                leadPhone: details?.phone,
                count: 1,
              }).catch((notifErr) => {
                console.error("[Webhook] Lead notification failed:", notifErr.message);
              });

              if (global.io) {
                global.io.to(`business:${String(business._id)}`).emit("newLead", {
                  count: 1,
                  businessId: String(business._id),
                  message: "1 new lead received",
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }
        }
      }
    }
  }

  res.status(200).send("Event received");
};

// ─────────────────────────────────────────────
// WhatsApp Cloud API Webhook Handlers
// ─────────────────────────────────────────────

const WA_STATUS_MAP = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

const WA_TEMPLATE_STATUS_MAP = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PENDING: "PENDING",
  IN_APPEAL: "IN_APPEAL",
  PAUSED: "PAUSED",
  DISABLED: "DISABLED",
};

const WA_STATUS_RANK = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 99,
};

const shouldApplyWhatsAppStatus = (currentStatus, nextStatus) => {
  if (!currentStatus) return true;
  if (currentStatus === nextStatus) return false;

  if (nextStatus === "FAILED") {
    return currentStatus !== "FAILED";
  }

  if (currentStatus === "FAILED") return false;

  return (WA_STATUS_RANK[nextStatus] || 0) > (WA_STATUS_RANK[currentStatus] || 0);
};

// GET /api/whatsapp/webhook — Meta verification
exports.getWhatsAppWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

// Meta signs the raw webhook body with the app secret (HMAC-SHA256) and sends
// it as X-Hub-Signature-256. Verifying it stops anyone else from posting a
// forged payload (fake delivery statuses, fake inbound messages) to this route,
// which has no other auth since Meta calls it directly.
function isValidMetaSignature(req) {
  const signature = req.headers["x-hub-signature-256"];
  const secret = process.env.clientSecret;
  if (!signature || !secret || !req.rawBody) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// POST /api/whatsapp/webhook — Meta status updates (sent/delivered/read/failed)
exports.postWhatsAppWebhook = async (req, res) => {
  res.status(200).send("OK");

  if (!isValidMetaSignature(req)) {
    console.warn("[WhatsApp Webhook] Rejected payload with missing/invalid X-Hub-Signature-256");
    return;
  }

  const payload = req.body;

  // Log payload for debugging
  try {
    const fs = require("fs");
    const logPath = require("path").join(__dirname, "../../webhook_payloads.log");
    fs.appendFileSync(logPath, `\n--- ${new Date().toISOString()} ---\n${JSON.stringify(payload, null, 2)}\n`);
  } catch (err) {
    console.error("Error logging webhook payload:", err.message);
  }

  if (payload.object !== "whatsapp_business_account") return;

  try {
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        // --- 0. ACCOUNT HEALTH (quality, messaging limit, review decision, Meta alerts) ---
        if (whatsappAccountHealthService.HEALTH_FIELDS.includes(change?.field)) {
          await whatsappAccountHealthService
            .handleHealthChange({ wabaId: String(entry.id), field: change.field, value: change.value || {} })
            .catch((err) => console.error(`[WA Webhook] ${change.field} handling failed:`, err.message));
          continue;
        }

        // --- 1. STATUS UPDATES (Sent/Delivered/Read/Failed) ---
        const statuses = change?.value?.statuses || [];
        for (const statusObj of statuses) {
          const { id: wamid, status, timestamp, errors } = statusObj;
          const newStatus = WA_STATUS_MAP[status];
          if (!newStatus) continue;

          const existingMessage = await whatsappMessageModel.findOne(
            { metaMessageId: wamid },
            "campaignId status businessId phoneNumberId conversationId direction to contactName textBody billingState billSource billCategory billPaise source billUserId"
          );

          if (!existingMessage || !shouldApplyWhatsAppStatus(existingMessage.status, newStatus)) {
            continue;
          }

          const dateField = `${newStatus.toLowerCase()}At`;
          const updatePayload = {
            status: newStatus,
            [dateField]: new Date(parseInt(timestamp) * 1000),
          };

          // If message was read directly without a delivered webhook, ensure deliveredAt is recorded
          if (newStatus === "READ" && (!existingMessage.status || existingMessage.status === "SENT" || existingMessage.status === "QUEUED")) {
            if (!updatePayload.deliveredAt) {
              updatePayload.deliveredAt = updatePayload.readAt;
            }
          }

          if (status === "failed" && errors?.[0]) {
            updatePayload.errorCode = String(errors[0].code || "");
            updatePayload.errorMessage = errors[0].message || "";
          }

          const message = await whatsappMessageModel.findOneAndUpdate(
            { _id: existingMessage._id },
            { $set: updatePayload },
            { new: true }
          );

          if (message) {
            await whatsappBilling.settleMessage(existingMessage, newStatus).catch((err) => {
              console.error("[WA Billing] settle failed:", err.message);
            });
            if (existingMessage.source === "API") {
              require("../services/whatsappDeveloperService")
                .notifyStatus(existingMessage, newStatus)
                .catch((err) => console.error("[WA Developer] status webhook failed:", err.message));
            }
            // Chat replies get a delivery (or failure) alert. A campaign blast
            // can be hundreds of numbers, so those stay on the campaign stats.
            const firstArrival =
              newStatus === "DELIVERED" ||
              (newStatus === "READ" &&
                existingMessage.status !== "DELIVERED" &&
                existingMessage.status !== "READ");
            if (
              !message.campaignId &&
              message.direction === "OUTBOUND" &&
              message.phoneNumberId &&
              (firstArrival || newStatus === "FAILED")
            ) {
              const owner = await whatsappAccountModel
                .findOne({ phoneNumberId: message.phoneNumberId, status: "CONNECTED" })
                .select("userId")
                .lean();
              if (owner?.userId) {
                await sendWhatsAppDeliveryNotification({
                  userId: owner.userId,
                  businessId: message.businessId,
                  conversationId: message.conversationId,
                  contactName: message.contactName,
                  phone: message.to,
                  preview: message.textBody,
                  failed: newStatus === "FAILED",
                  errorMessage: message.errorMessage,
                }).catch((err) => console.error("[WA Webhook] delivery notification failed:", err.message));
              }
            }

            if (message.campaignId) {
              const incPayload = { [`stats.${newStatus.toLowerCase()}`]: 1 };
              if (newStatus === "READ" && (!existingMessage.status || existingMessage.status === "SENT" || existingMessage.status === "QUEUED")) {
                incPayload["stats.delivered"] = 1;
              }
              await whatsappCampaignModel.findByIdAndUpdate(message.campaignId, {
                $inc: incPayload,
              });
            }

            // Emit real-time update via Socket.IO
            if (global.io) {
              const statusData = {
                messageId: String(message._id),
                conversationId: String(message.conversationId || ""),
                metaMessageId: wamid,
                wamid,
                status: newStatus,
                errorCode: message.errorCode,
                errorMessage: message.errorMessage,
              };

              if (message.campaignId) {
                global.io
                  .to(`campaign:${message.campaignId}`)
                  .emit("messageStatusUpdate", {
                    campaignId: String(message.campaignId),
                    ...statusData,
                  });
                global.io
                  .to(`campaign:${message.campaignId}`)
                  .emit("campaignStatsUpdate", {
                    campaignId: String(message.campaignId),
                    status: newStatus,
                  });
              }

              if (message.conversationId) {
                global.io
                  .to(`conversation:${message.conversationId}`)
                  .emit("messageStatusUpdate", statusData);
              }

              const targetBizId = message.businessId || existingMessage.businessId;
              if (targetBizId) {
                global.io
                  .to(`business:${targetBizId}`)
                  .emit("messageStatusUpdate", statusData);
                global.io
                  .to(`business:${targetBizId}`)
                  .emit("campaignStatsUpdate", {
                    campaignId: String(message.campaignId || ""),
                    status: newStatus,
                  });
              }
            }
          }
        }

        // --- 1b. TEMPLATE STATUS UPDATES (Meta approves/rejects/pauses a template) ---
        // Without this, a template's local status only changes when a user
        // manually hits "sync" — this makes it update live as Meta reviews it.
        if (change?.field === "message_template_status_update" && change?.value) {
          const { message_template_id: metaTemplateId, event, reason } = change.value;
          const newStatus = WA_TEMPLATE_STATUS_MAP[event];
          if (metaTemplateId && newStatus) {
            const previous = await whatsappTemplateModel
              .findOne({ metaTemplateId: String(metaTemplateId) })
              .select("status createdBy businessId name")
              .lean();
            if (previous && previous.status !== newStatus) {
              const template = await whatsappTemplateModel.findOneAndUpdate(
                { _id: previous._id },
                { $set: { status: newStatus, rejectedReason: newStatus === "REJECTED" ? (reason || "") : "" } },
                { new: true }
              );
              if (template && global.io && template.businessId) {
                global.io.to(`business:${template.businessId}`).emit("templateStatusUpdate", {
                  templateId: String(template._id),
                  status: newStatus,
                });
              }
              if (template?.createdBy && ["APPROVED", "REJECTED", "PAUSED", "DISABLED"].includes(newStatus)) {
                await sendTemplateStatusNotification({
                  userId: template.createdBy,
                  templateId: template._id,
                  templateName: template.name,
                  status: newStatus,
                  reason,
                }).catch((err) => console.error("[WA Webhook] template notification failed:", err.message));
              }
            }
          }
        }

        // --- 2. INCOMING MESSAGES (Customer Replies) ---
        const messages = change?.value?.messages || [];
        const metadata = change?.value?.metadata || {};
        const contacts = change?.value?.contacts || [];

        for (const msg of messages) {
          const realWabaId = entry.id; // Correct WABA ID
          const phoneNumberId = metadata?.phone_number_id; // Correct Phone Number ID
          const customerPhoneRaw = msg?.from;
          const phoneVariants = getPhoneVariants(customerPhoneRaw);
          const customerPhone = phoneVariants[0] || customerPhoneRaw;
          const wamid = msg?.id;
          
          if (!phoneNumberId || !customerPhone) continue;
          // Never route a shared or unowned number into an arbitrary tenant inbox.
          const phoneOwners = await whatsappAccountModel.find({ phoneNumberId }).limit(2).select('userId status');
          if (phoneOwners.length !== 1 || phoneOwners[0].status !== 'CONNECTED') continue;
          const ownerUserId = phoneOwners[0].userId;
          const ownerBusinesses = await businessModel.find({ userId: ownerUserId }).select('_id');
          const ownerBusinessIds = ownerBusinesses.map(b => b._id);


          let customerName = "Unknown";
          const contactInfo = contacts.find((c) => {
            const waIdDigits = String(c?.wa_id || "").replace(/\D/g, "");
            return waIdDigits && phoneVariants.includes(waIdDigits);
          });
          if (contactInfo && contactInfo.profile && contactInfo.profile.name) {
            customerName = contactInfo.profile.name;
          }

          let textBody = "";
          let msgType = "UNKNOWN";
          let flowReply = null;

          if (msg.type === "text" && msg.text) {
            textBody = msg.text.body;
            msgType = "TEXT";
          } else if (msg.type === "button" && msg.button) {
            textBody = msg.button.text;
            msgType = "TEXT";
          } else if (msg.type === "interactive" && msg.interactive) {
            if (msg.interactive.type === "button_reply") {
              textBody = msg.interactive.button_reply.title;
            } else if (msg.interactive.type === "list_reply") {
              textBody = msg.interactive.list_reply.title;
            } else if (msg.interactive.type === "nfm_reply") {
              // A completed WhatsApp Flow (form): show the answers as readable text.
              flowReply = await whatsappFlowService
                .describeReply({ userId: ownerUserId, wabaId: realWabaId, nfmReply: msg.interactive.nfm_reply })
                .catch((err) => {
                  console.error("[WA Webhook] flow reply parse failed:", err.message);
                  return null;
                });
              textBody = flowReply?.text || "📋 Form submitted";
            } else if (msg.interactive.type === "call_permission_reply") {
              textBody = msg.interactive.call_permission_reply?.response === "accept"
                ? "📞 Allowed WhatsApp calls from you"
                : "📞 Declined WhatsApp calls";
            }
            msgType = "INTERACTIVE";
          } else if (["image", "video", "document", "audio", "sticker"].includes(msg.type)) {
            textBody = `[${msg.type.toUpperCase()}]`;
            msgType = "MEDIA";
          } else {
            textBody = `[${msg.type.toUpperCase()}]`;
          }

          // --- Smart Routing: Attribute reply to the correct business owner ---
          let businessId = null;
          let businessIds = []; // Track all businesses of the user for real-time notification
          
          // 1. Try to find the most recent OUTBOUND message to this customer from this PNID
          // This ensures we attribute the reply to the person who sent the template.
          let lastOutbound = null;

          if (phoneNumberId) {
            lastOutbound = await whatsappMessageModel.findOne({
              to: { $in: phoneVariants.length ? phoneVariants : [customerPhone] },
              direction: "OUTBOUND",
              phoneNumberId,
              businessId: { $in: ownerBusinessIds },
            }).sort({ createdAt: -1 }).select("businessId campaignId");
          }


          if (lastOutbound) {
            if (lastOutbound.businessId) {
              businessId = lastOutbound.businessId;
            } else if (lastOutbound.campaignId) {
              const campaign = await whatsappCampaignModel.findById(lastOutbound.campaignId).select("businessId");
              const campaignOwned = campaign?.businessId && ownerBusinessIds.some(
                (id) => String(id) === String(campaign.businessId)
              );
              if (campaignOwned) businessId = campaign.businessId;
            }
          }

          if (!businessId) {
            const businesses = await businessModel.find({ userId: ownerUserId }).select("_id");
            businessIds = businesses.map(b => b._id);
            if (businessIds.length > 0) businessId = businessIds[0];
          }

          // Ensure businessIds contains ALL businesses of the user for real-time notification
          if (businessId && businessIds.length === 0) {
            const b = await businessModel.findById(businessId).select("userId");
            if (b && b.userId) {
              const businesses = await businessModel.find({ userId: b.userId }).select("_id");
              businessIds = businesses.map(item => item._id);
            }
          }

          let conversation = await whatsappConversationModel.findOne({
            phoneNumberId,
            businessId: { $in: ownerBusinessIds },
            customerPhone: { $in: phoneVariants.length ? phoneVariants : [customerPhone] },
          });

          if (!conversation) {
            conversation = await whatsappConversationModel.create({
              businessId,
              wabaId: realWabaId,
              phoneNumberId,
              customerPhone,
              customerName,
              lastMessage: textBody.substring(0, 50),
              lastMessageAt: new Date(parseInt(msg.timestamp) * 1000),
              unreadCount: 1,
              status: "OPEN"
            });
          } else {
            conversation.lastMessage = textBody.substring(0, 50);
            conversation.lastMessageAt = new Date(parseInt(msg.timestamp) * 1000);
            conversation.unreadCount += 1;
            if (customerName !== "Unknown") conversation.customerName = customerName;
            if (realWabaId) conversation.wabaId = realWabaId;
            if (businessId) conversation.businessId = businessId; // Always link to most recent sender
            await conversation.save();
          }

          // Click-to-WhatsApp ad click id (first touch), needed to report leads/sales to Meta later.
          await whatsappConversionService
            .captureReferral({ conversationId: conversation._id, message: msg })
            .catch((err) => console.error("[WA Webhook] CTWA referral capture failed:", err.message));

          const effectiveBusinessId = businessId || conversation.businessId || null;

          // Link any orphaned OUTBOUND messages to this conversation
          // This 'syncs' the campaign message into the chat thread retroactively.
          await whatsappMessageModel.updateMany(
            {
              to: { $in: phoneVariants.length ? phoneVariants : [customerPhone] },
              phoneNumberId,
              conversationId: null,
              direction: "OUTBOUND",
            },
            { $set: { conversationId: conversation._id } }
          );

          const existingInbound = await whatsappMessageModel.findOne({ metaMessageId: wamid });
          if (!existingInbound) {
            // Create message
            const createdMsg = await whatsappMessageModel.create({
              conversationId: conversation._id,
              businessId: businessId, // Fixed: use local businessId instead of outer effectiveBusinessId
              phoneNumberId,
              to: customerPhone,
              contactName: customerName,
              direction: "INBOUND",
              type: msgType,
              textBody: textBody,
              metaMessageId: wamid,
              status: "DELIVERED",
              sentAt: new Date(parseInt(msg.timestamp) * 1000),
            });

            if (flowReply) {
              await whatsappFlowService
                .recordReply(flowReply, {
                  userId: ownerUserId,
                  businessId,
                  conversationId: conversation._id,
                  wabaId: realWabaId,
                  phoneNumberId,
                  customerPhone,
                  customerName: conversation.customerName || customerName,
                  wamid,
                  receivedAt: createdMsg.sentAt,
                })
                .catch((err) => console.error("[WA Webhook] flow reply save failed:", err.message));
            }

            // Prepare unified payload for inbox & chat
            const botAllowed = ownerUserId ? await chatbotAccess.allowsBot(ownerUserId) : false;
            const convObj = {
              _id: String(conversation._id),
              businessId: businessId,
              customerPhone: customerPhone,
              customerName: conversation.customerName || customerName,
              contactPhone: customerPhone,
              contactName: conversation.customerName || customerName,
              lastMessage: textBody.substring(0, 50),
              lastMessageAt: conversation.lastMessageAt,
              unreadCount: conversation.unreadCount || 1,
              status: conversation.status || "OPEN",
              isBotActive: botAllowed && conversation.isBotActive !== false,
            };

            const messagePayload = {
              conversationId: String(conversation._id),
              customerPhone,
              customerName: convObj.customerName,
              textBody,
              content: textBody,
              direction: "INBOUND",
              type: msgType,
              messageType: msgType,
              status: "DELIVERED",
              createdAt: createdMsg.createdAt || new Date(),
              sentAt: createdMsg.sentAt || new Date(),
              _id: String(createdMsg._id),
              message: createdMsg,
              conversation: convObj,
            };

            // Emit real-time update
            if (global.io) {
              if (businessIds.length > 0) {
                businessIds.forEach(bId => {
                  global.io.to(`business:${bId}`).emit("newWhatsAppMessage", messagePayload);
                  global.io.to(`business:${bId}`).emit("conversationUpdated", convObj);
                });
              }

              if (ownerUserId) {
                global.io.to(`user:${ownerUserId}`).emit("newWhatsAppMessage", messagePayload);
                global.io.to(`user:${ownerUserId}`).emit("conversationUpdated", convObj);
              }

              // Emit to conversation room (for live chat screen)
              global.io.to(`conversation:${conversation._id}`).emit("newWhatsAppMessage", messagePayload);
              global.io.to(`conversation:${conversation._id}`).emit("chatMessage", messagePayload);
            }

            if (ownerUserId) {
              await sendWhatsAppInboundNotification({
                userId: ownerUserId,
                businessId,
                conversationId: conversation._id,
                customerName: convObj.customerName,
                customerPhone,
                preview: textBody,
              }).catch((err) => console.error("[WA Webhook] inbound notification failed:", err.message));
            }

            // AI chatbot: FAQ first → OpenAI fallback (fire-and-forget; keep Meta ACK fast)
            if ((conversation.isBotActive ?? true) && msgType === "TEXT" && textBody) {
              void whatsappBotService.handleInbound({
                conversation,
                textBody,
                phoneNumberId,
                msgType,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[WA Webhook] Error processing webhook:", err);
  }
};
//         );
//         continue; // Skip this campaign if the necessary data is missing
//       }

//       const pageAccessToken = businessId.pageAccessToken;

//       // Store the current scheduler run time
//       const currentSchedulerRunTime = new Date();

//       try {
//         // Fetch leads from Meta API for Facebook and Instagram ad IDs
//         const fbLeads = await fetchLeadsFromMetaAPI(
//           mainAdId,
//           lastSchedulerRunTime,
//           pageAccessToken
//         );

//         // Check if leads do not already exist and save them
//         await saveLeadsIfNotExist(fbLeads, campaign);

//         // Update the adset with the new scheduler run time
//         await addDetailsModel.updateOne(
//           { _id: campaign._id },
//           {
//             lastSchedulerRunTime: currentSchedulerRunTime,
//             is_lead_data_fetched: true,
//           }
//         );

//         console.log(
//           `Leads fetched and saved for campaign with mainAdId: ${mainAdId}`
//         );
//       } catch (error) {
//         console.error(`Error processing campaign ${campaign._id}:`, error);
//       }
//     }
//   } catch (error) {
//     console.error("Error fetching campaigns:", error);
//   }

//   console.log("Scheduler finished");
// });

// // Function to fetch leads from Meta API
// async function fetchLeadsFromMetaAPI(
//   adSetId,
//   lastSchedulerRunTime,
//   pageAccessToken
// ) {
//   try {
//     const url = `https://graph.facebook.com/v21.0/${adSetId}/leads?access_token=${pageAccessToken}&filtering=[ 
//     { 
//       "field": "time_created", 
//       "operator": "GREATER_THAN", 
//       "value": 1721715952 
//     } 
//   ]`;
//
//     const response = await axios.get(url);
//     console.log(response.data.data, "response.data.data");
//     return response.data.data;
//   } catch (error) {
//     console.error("Error fetching leads:", error?.message);
//     return [];
//   }
// }
// 
// // Function to save leads if they do not already exist
// async function saveLeadsIfNotExist(leads, addDetails) {
//   for (const lead of leads) {
//     const leadExists = await leadModel.findOne({ leadgenId: lead?.id });
//   }
// }
//  changes

exports.getAllLeadsByPagination = async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const skip = (page - 1) * limit;

  try {
    const query = search ? { name: new RegExp(search, "i") } : {};

    const leads = await leadModel
      .find(query)
      .skip(skip)
      .populate("businessId")
      .populate("statusUpdatedBy", "name image mobile")
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const totalLeads = await leadModel.countDocuments(query);
    const totalPages = Math.ceil(totalLeads / limit);

    res.status(200).json({
      success: true,
      message: "All Leads fetched successfully",
      data: leads,
      page: parseInt(page),
      totalPages,
      totalLeads,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching leads",
      error: error.message,
    });
  }
};


/**
 * GET /getAllLeadsByPaginationForAdmin?userId=&businessId=&page=&limit=&search=
 *
 * The lead list behind both the app's Leads tab and the admin panel.
 *
 * It used to project four fields — name, email, `phone` and createdAt — and
 * `phone` is not a field on leadModel at all, so every lead reached the app
 * with no number to call, no status and no idea which ad produced it. It also
 * demanded a `userId`, which is why the admin panel's own leads page answered
 * 400. Both are fixed here: admins see everything, everyone else sees their own
 * businesses' leads and nothing else.
 */
exports.getAllLeadsByPaginationForAdmin = async (req, res) => {
  const { page = 1, limit = 20, search, userId, businessId, stage } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * pageSize;

  try {
    const requester = req.user;
    const isAdmin = requester?.userType === "ADMIN";
    // A team member's leads are their owner's leads; anyone else asking about
    // another account is quietly answered with their own.
    const ownsRequestedAccount =
      !userId ||
      String(userId) === String(requester?._id) ||
      String(userId) === String(requester?.userId || "");
    const scopeUserId = isAdmin
      ? userId || null
      : ownsRequestedAccount
        ? userId || requester?.userId || requester?._id
        : requester?._id;

    const filter = {};

    if (scopeUserId) {
      const userBusinesses = await businessModel
        .find({ userId: scopeUserId }, { _id: 1 })
        .lean();
      filter.businessId = { $in: userBusinesses.map((b) => b._id) };
    }

    if (businessId && mongoose.Types.ObjectId.isValid(businessId)) {
      const allowed =
        !filter.businessId ||
        filter.businessId.$in.some((id) => String(id) === String(businessId));
      if (!allowed) {
        return res.status(200).json({
          success: true,
          message: "All Leads fetched successfully",
          data: [],
          page: pageNum,
          limit: pageSize,
          totalPages: 0,
          totalLeads: 0,
        });
      }
      filter.businessId = new mongoose.Types.ObjectId(businessId);
    }

    if (stage && stage !== "ALL") filter.leadStatus = stage;

    if (search) {
      const rx = new RegExp(String(search).trim(), "i");
      const or = [
        { name: rx },
        { email: rx },
        { userContactNumber: rx },
        { whatsappNumber: rx },
      ];
      // Searching by business name stays possible without an aggregation join.
      const businessScope = filter.businessId
        ? { _id: filter.businessId }
        : {};
      const matchedBusinesses = await businessModel
        .find({ ...businessScope, businessName: rx }, { _id: 1 })
        .lean();
      if (matchedBusinesses.length) {
        or.push({ businessId: { $in: matchedBusinesses.map((b) => b._id) } });
      }
      filter.$or = or;
    }

    const [leads, totalLeads] = await Promise.all([
      leadModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate({
          path: "businessId",
          select: "businessName businessContact whatsappNumber userId",
          populate: { path: "userId", select: "name mobile email" },
        })
        .populate({
          path: "userId",
          select: "name mobile email",
        })
        .populate({
          path: "statusUpdatedBy",
          select: "name mobile email",
        })
        .populate({
          path: "internalCampiagnId",
          select: "title image thambnail status addTypeId",
          populate: { path: "addTypeId", select: "title advertisementType" },
        })
        .lean(),
      leadModel.countDocuments(filter),
    ]);

    const data = leads.map((lead) => {
      const ad = lead.internalCampiagnId;
      const image = Array.isArray(ad?.image) ? ad.image[0] : ad?.image;
      return {
        ...lead,
        // Kept under both names: the app reads `business`, the admin panel
        // reads the populated `businessId`.
        business: lead.businessId
          ? { businessName: lead.businessId.businessName }
          : null,
        adName: ad?.title || null,
        adTypeName: ad?.addTypeId?.title || null,
        adImage: image || ad?.thambnail || null,
        adStatus: ad?.status || null,
      };
    });

    res.status(200).json({
      success: true,
      message: "All Leads fetched successfully",
      data,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(totalLeads / pageSize),
      totalLeads,
      totalCount: totalLeads,
    });
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

/**
 * GET /leads/syncNow?businessId=&internalCampaignId=
 *
 * Pull-to-refresh on the Leads tab. Asks Meta directly for the Instant Form
 * leads of this business and stores anything the webhook never delivered, so a
 * lead that Meta already has can never be sitting invisible for an hour until
 * the cron runs.
 */
exports.syncLeadsNow = async (req, res) => {
  try {
    const { businessId, internalCampaignId } = req.query;
    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return res
        .status(400)
        .json({ success: false, message: "A valid businessId is required" });
    }

    const requester = req.user;
    const business = await businessModel
      .findById(businessId)
      .select("userId")
      .lean();
    if (!business) {
      return res.status(404).json({ success: false, message: "Business not found" });
    }

    const isAdmin = requester?.userType === "ADMIN";
    const ownsBusiness =
      String(business.userId) === String(requester?._id) ||
      String(business.userId) === String(requester?.userId || "");
    if (!isAdmin && !ownsBusiness) {
      return res
        .status(403)
        .json({ success: false, message: "This business is not yours" });
    }

    const result = await syncLeadsForBusiness(businessId, {
      internalCampaignId:
        internalCampaignId && mongoose.Types.ObjectId.isValid(internalCampaignId)
          ? internalCampaignId
          : null,
    });

    return res.status(200).json({
      success: true,
      message: result.reason || "Leads synced with Meta",
      data: result,
    });
  } catch (error) {
    console.error("syncLeadsNow error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};



exports.getSingleLeadDetail = async (req, res) => {
  const { leadId } = req.query;

  try {
    const lead = await leadModel.findById(leadId).populate("businessId");

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Lead fetched successfully",
      data: lead,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getLeadOfYourBussinessByMemberId = async (req, res) => {
  try {
    const {
      businessId,
      adId,
      internalCampaignId,
      stage,
      name,
      sortByDate = -1,
      page = 1,
      startDate,
      endDate,
    } = req.query;

    const filter = {};
    const skip = (parseInt(page) - 1) * 20;

    // Basic filters
    if (businessId) filter.businessId = businessId;
    if (adId) filter.adId = adId;
    // Filtering by campaign rather than by ad id survives an ad being rebuilt:
    // the new ad has a new Meta id, but every lead still points at the campaign.
    if (internalCampaignId && mongoose.Types.ObjectId.isValid(internalCampaignId)) {
      filter.internalCampiagnId = internalCampaignId;
    }
    if (name) {
      const searchRegex = new RegExp(name, "i");
      filter.$or = [
      { name: searchRegex },
      { userContactNumber: searchRegex }
      ];
    }
    if (stage && stage !== "ALL") filter.leadStatus = stage;

    // Date filter - with validation
    if (startDate || endDate) {
      const dateFilter = {};
      
      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid startDate format. Please use ISO date format (YYYY-MM-DD)",
          });
        }
        dateFilter.$gte = new Date(start.setHours(0, 0, 0, 0));
      }

      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid endDate format. Please use ISO date format (YYYY-MM-DD)",
          });
        }
        dateFilter.$lte = new Date(end.setHours(23, 59, 59, 999));
      }

      filter.createdAt = dateFilter;
    }

    // Sorting
    const sortOptions = sortByDate == 1 ? { createdAt: 1 } : { createdAt: -1 };

	 let fi = {
		 businessId: businessId,
	 }
    // Fetch lead
    const [leads, totalCount, count] = await Promise.all([
      leadModel.find(filter)
        .populate({
          path: "internalCampiagnId",
          select: "title image thambnail addTypeId status",
          populate: { path: "addTypeId", select: "title advertisementType" },
        })
        .sort(sortOptions)
       .skip(skip)
       .limit(20),
      leadModel.countDocuments(filter),
      leadModel.countDocuments(fi),
    ]);

    // Attach the source ad so the app can show which campaign produced the lead
    const leadsWithAds = leads.map((lead) => {
      const ad = lead?.internalCampiagnId;
      const image = Array.isArray(ad?.image) ? ad.image[0] : ad?.image;
      return {
        ...lead.toObject(),
        adImage: image || ad?.thambnail || null,
        adName: ad?.title || null,
        adTypeName: ad?.addTypeId?.title || null,
        adStatus: ad?.status || null,
      };
    });

    // Send response
    return res.status(200).json({
      success: true,
      message: "Leads fetched successfully with ad images",
      data: leadsWithAds,
      totalPages: Math.ceil(totalCount / 20),
      currentPage: parseInt(page),
      totalCount,
      // Same number under the name the mobile app reads.
      totalLeads: totalCount,
	  check: count == 0 ? true : false
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Error fetching leads",
    });
  }
};

exports.updateLeadDetails = async (req, res) => {
  const { leadId } = req.query;
  console.log(leadId, "leadId");
  const { followUpDate, note, leadStatus, followUpTime, followUpNote } =
    req.body;
  let leadActivity = await leadModel.findById(leadId);

  if (!leadActivity.rescentActivity) {
    leadActivity.rescentActivity = [];
  }
  leadActivity.rescentActivity.push({
    activity: followUpDate
      ? `Follow Up : ${followUpDate}`
      : note
      ? `Note Update : ${note}`
      : `Lead Status : ${leadStatus}`,
    date: new Date().toISOString(),
  });
  console.log(leadActivity.rescentActivity, "newRescentActivity");
  const updateData = await leadModel.findOneAndUpdate(
    { _id: leadId },
    {
      $set: {
        followUpDate,
        followUpTime,
        followUpNote,
        rescentActivity: leadActivity.rescentActivity,
        note,
        leadStatus,
        // Track who updated status and when
        ...(leadStatus && {
          statusUpdatedAt: new Date(),
          statusUpdatedBy: req.user._id,
        }),
      },
    },
    {
      new: true,
    }
  );
  // await leadHistoryChangeStatusModel.create({
  //   leadId: updateData._id,
  //   historyType: leadStatus != undefined ? "STATUSCHANGE" : "ACTIONTYPE",
  //   actionType:
  //     followUpDate != undefined ? "FOLLOW_UP_DATE_SET" : "LEAD_CONTACT_CHANGES",
  //   statusChange: leadStatus,
  //   userId: req.user._id,
  // });
  // console.log(updateData);

  return res
    .status(200)
    .send({ success: true, message: "update successfully", data: updateData });
};

// exports.updateLeadDetails = async (req, res) => {

//   const { leadId } = req.query;
//   const {
//     adsetId,
//     adId,
//     name,
//     userContactNumber,
//     whatsappNumber,
//     email,
//     followUpDate,
//     note,
//     leadStatus,
//   } = req.body;
//   const updateData = await leadModel.findOneAndUpdate(
//     { _id: leadId },
//     {
//       $set: {
//         adsetId:adsetId,
//         adId:adId,
//         name:name,
//         userContactNumber:userContactNumber,
//         whatsappNumber:whatsappNumber,
//         email:email,
//         followUpDate:followUpDate,
//         note:note,
//         leadStatus:leadStatus,
//       },
//     },
//     {
//       new:true
//     }
//   );
//   return res.status(200).send({success:true,message:"update successfully",data:updateData})
// };

//  changes

exports.getLeadDetails = async (req, res) => {
  const { leadId } = req.query;
  const leadExists = await leadModel.findById(leadId);
  return res.status(200).json({
    success: true,
    message: "Get Lead Details",
    data: leadExists,
  });
};

exports.updateLeadSeenStatus = async (req, res) => {
  const { leadId } = req.query;

  try {
    const find = await leadModel.findOne({_id:leadId,seen:true});
    if(!find){
      let rescentActivity = [];
      rescentActivity.push({
        activity: "Lead Seen",
        date: new Date().toISOString(),
      });
      var updatedLead = await leadModel.findByIdAndUpdate(
        leadId,
        { $set: { seen: true, rescentActivity } },
        { new: true }
      );
    }
 



    return res.status(200).json({
      success: true,
      message: "Lead seen status updated successfully",
      data: updatedLead ? updatedLead : find ,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.uploadLeadDocument = async (req, res) => {
  const { leadId, type, index } = req.body;

  try {
    const lead = await leadModel.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    // Ensure document array exists
    if (!Array.isArray(lead.document)) {
      lead.document = [];
    }

    if (type === "ADD") {
      // Handle file upload
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }
      // Save file information to lead document
      lead.document.push(file.location);
      await lead.save();

      return res.status(200).json({
        success: true,
        message: "Document uploaded successfully",
        data: lead,
      });
    } else if (type === "REMOVE") {
      // Remove document at given index
      if (
        typeof index === "undefined" ||
        !lead.document[index]
      ) {
        return res.status(400).json({
          success: false,
          message: "Document not found at given index",
        });
      }
      lead.document.splice(index, 1);
      await lead.save();

      return res.status(200).json({
        success: true,
        message: "Document removed successfully",
        data: lead,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid type. Use 'ADD' or 'REMOVE'.",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



const XLSX = require("xlsx");
const { uploadBuffer } = require("../utils/spacesClient");

exports.getLeadOfYourBusinessByMemberIdExcel = async (req, res) => {
  try {
    const {
      businessId,
      adId,
      stage,
      name,
      sortByDate = -1,
      startDate,
      endDate,
    } = req.query;

    const filter = {};

    // Basic filters
    if (businessId) filter.businessId = businessId;
    if (adId) filter.adId = adId;
    if (name) {
      const searchRegex = new RegExp(name, "i");
      filter.$or = [
        { name: searchRegex },
        { userContactNumber: searchRegex },
      ];
    }
    if (stage && stage !== "ALL") filter.leadStatus = stage;

    // Date filter - with validation
    if (startDate || endDate) {
      const dateFilter = {};
      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid startDate format. Please use ISO date format (YYYY-MM-DD)",
          });
        }
        dateFilter.$gte = new Date(start.setHours(0, 0, 0, 0));
      }
      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid endDate format. Please use ISO date format (YYYY-MM-DD)",
          });
        }
        dateFilter.$lte = new Date(end.setHours(23, 59, 59, 999));
      }
      filter.createdAt = dateFilter;
    }

    // Sorting
    const sortOptions = sortByDate == 1 ? { createdAt: 1 } : { createdAt: -1 };

    let fi = { businessId: businessId };

    // Fetch all leads
    const [leads, totalCount, count] = await Promise.all([
      leadModel
        .find(filter)
        .populate("internalCampiagnId")
        .sort(sortOptions),
      leadModel.countDocuments(filter),
      leadModel.countDocuments(fi),
    ]);

    if (!leads.length) {
      return res.status(404).json({ success: false, message: "No leads found" });
    }

    // Prepare flat data for Excel/CSV
    const flatData = leads.map((lead) => ({
      name: lead.name || "N/A",
      userContactNumber: lead.userContactNumber || "N/A",
      leadStatus: lead.leadStatus || "N/A",
      createdAt: lead.createdAt ? new Date(lead.createdAt).toISOString() : "N/A",
    }));

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(flatData);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");

    // Write buffer for Excel
    const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const csvData = XLSX.utils.sheet_to_csv(worksheet);

    const timestamp = Date.now();

    // Upload Excel and CSV to DigitalOcean Spaces
    const excelUpload = uploadBuffer(excelBuffer, {
      folder: "MARKETINGKART/EXPORTS",
      resourceType: "raw",
      publicId: `leads_${timestamp}_excel`,
    });

    const csvUpload = uploadBuffer(Buffer.from(csvData), {
      folder: "MARKETINGKART/EXPORTS",
      resourceType: "raw",
      publicId: `leads_${timestamp}_csv`,
    });

    const [excelResult, csvResult] = await Promise.all([excelUpload, csvUpload]);

    return res.status(200).json({
      success: true,
      message: "Files uploaded successfully",
      excelDownloadUrl: excelResult.secure_url,
      csvDownloadUrl: csvResult.secure_url,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error generating or uploading files",
      error: error.message,
    });
  }
};

exports.bulkImportLeads = async (req, res) => {
  try {
    const { businessId, contacts } = req.body;

    if (!businessId || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid request. Missing businessId or contacts array.",
      });
    }

    const newLeads = contacts.map((c) => ({
      businessId,
      name: c.name || "Unknown",
      userContactNumber: c.userContactNumber,
      email: c.email || null,
      leadSource: "IMPORT",
      leadStatus: "NEW",
    }));

    // Use insertMany for efficient bulk insertion
    // ordered: false allows continuing if some inserts fail (e.g. duplicate keys if unique index exists)
    const result = await leadModel.insertMany(newLeads, { ordered: false });

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${result.length} contacts.`,
      data: result,
    });
  } catch (error) {
    // If some inserts failed due to validation/duplicates but others succeeded, 
    // Mongoose might throw an error but still insert some. 
    // For now, simple error handling.
    return res.status(500).json({
      success: false,
      message: error.message || "Error during bulk import",
    });
  }
};


exports.getDebugLogs = async (req, res) => {
  try {
    const fs = require("fs");
    const path = require("path");
    const logPath = path.join(__dirname, "../../webhook_payloads.log");
    
    if (!fs.existsSync(logPath)) {
      return res.status(200).json({ message: "Log file not found yet. Try sending a message first." });
    }
    
    const logs = fs.readFileSync(logPath, "utf8");
    res.status(200).send(`<pre>${logs}</pre>`);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
