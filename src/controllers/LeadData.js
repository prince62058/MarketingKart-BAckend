const cron = require("node-cron");
const axios = require("axios");
const leadModel = require("../models/leadModel");
const leadFormsModel = require("../models/leadFormsModel");
const internalCampiagnModel = require("../models/internalCampiagnModel");
const business = require("../models/businessModel");
const userModel = require("../models/userModel");
const { sendNotificationToMultipleToken } = require("./notificationController");
const { sendLeadNotification } = require("../helpers/appNotificationHelper");
const { AD_KIND, findAdTypeIdByKind } = require("../helpers/adTypeHelper");

// ✅ Prevent multiple schedulers from starting

// ⏱ Run every hour at 20th minute (e.g., 1:20, 2:20, etc.)
cron.schedule("10 * * * *", async () => {
  console.log("🚀 Scheduler started");


  try {
    // Resolved per run instead of hardcoded: a hardcoded id meant this scheduler
    // matched nothing after the ad types were re-seeded, so no lead ever synced.
    const leadFormAdTypeId = await findAdTypeIdByKind(AD_KIND.LEAD_FORM);
    if (!leadFormAdTypeId) {
      console.warn("⚠️ No Lead Form advertisement type configured — skipping lead sync");
      return;
    }

    const businessData = await internalCampiagnModel
      .find({
        addTypeId: leadFormAdTypeId,
        status: "ACTIVE",
      })
      .populate("businessId", "pageId pageAccessToken lastSchedulerRunTime metaAdsetId mainAdId userId")
      .sort({ createdAt: -1 });

    for (const busines of businessData) {
      const pageAccessToken = busines?.businessId?.pageAccessToken;
      const lastSchedulerRunTime = busines?.businessId?.lastSchedulerRunTime;
      const pageId = busines?.businessId?.pageId;
      // console.log(`📅 Processing business: ${busines._id} - Page ID: ${pageId}  ===. ${pageAccessToken}`);
      try {
        const fbLeads = await fetchLeadsFromMetaAPI(pageId, pageAccessToken, lastSchedulerRunTime);

        if (fbLeads.length > 0) {
          await saveLeadsIfNotExist(fbLeads, busines);
        }
      } catch (error) {
        console.error("❌ Error fetching leads from Meta API:", error.message);
      }
    }
  } catch (error) {
    console.error("❌ Error in scheduler main try block:", error.message);
  }

  console.log("✅ Scheduler finished");
});

// -------------------------------------------
// 🔁 HELPER FUNCTIONS BELOW
// -------------------------------------------

async function fetchLeadsFromMetaAPI(pageId, pageAccessToken) {
  try {
    const forms = await fetchLeadForms(pageId, pageAccessToken);
    let leads = [];
    for (const form of forms) {
      const formId = form.id;
      const leadsForForm = await fetchLeads(formId, pageAccessToken);
      const formData = await leadFormsModel.findOne({ formId }).select("internalCampiagnId");
      // const filteredLeads = leadsForForm.filter((lead) => {
      //   const createdTime = new Date(lead.created_time).getTime();
      //   return !lastSchedulerRunTime || createdTime > new Date(lastSchedulerRunTime * 1000).getTime();
      // });

      const enrichedLeads = leadsForForm.map((lead) => ({
        ...lead,
        internalCampiagnId: formData?.internalCampiagnId || null,
      }));

      leads.push(...enrichedLeads);
    }

    return leads;
  } catch (error) {
    console.error("❌ Error in fetchLeadsFromMetaAPI:", error.message);
    return [];
  }
}

async function saveLeadsIfNotExist(leads, busines) {
  let newLeadsCount = 0;
  console.log(`📊 Saving ${leads.length} leads for business: ${busines._id}`);
  for (const lead of leads) {
    try {
      if (!lead?.id) continue;

      // Only sync Instant Form leads that belong to THIS linked Meta ad.
      // Skipping unmatched page forms prevents historical Instant Form leads
      // from flooding WhatsApp/CTWA businesses (and from reappearing after cleanup).
      const metaAdId = lead.ad_id || null;
      const metaAdsetId = lead.adset_id || null;
      const matchesCurrentCampaign =
        !!busines.mainAdId && metaAdId && (
          String(metaAdId) === String(busines.mainAdId) ||
          String(metaAdId) === String(busines.metaAdId || "")
        );

      if (!matchesCurrentCampaign) {
        continue;
      }

      const businessDoc = busines.businessId;
      const businessId =
        businessDoc?._id || businessDoc || busines.businessId || null;
      const pageId = businessDoc?.pageId || busines.pageId || null;

      const result = await leadModel.updateOne(
        { leadgenId: lead.id },
        {
          $setOnInsert: {
            businessId,
            adsetId: metaAdsetId || busines.metaAdsetId || null,
            internalCampiagnId: lead?.internalCampiagnId || busines._id || null,
            adId: metaAdId || busines.mainAdId,
            pageId,
            leadgenId: lead.id,
            createdTime: lead.created_time,
            leadSource: "META",
            leadStatus: "NEW",
            userContactNumber:
              lead?.phone_number ||
              lead?.phone ||
              lead?.mobile_number ||
              lead?.mobile ||
              null,
            name: lead?.full_name || lead?.name || null,
            email: lead?.email || null,
            whatsappNumber:
              lead?.whatsapp_number ||
              lead?.whatsapp ||
              lead?.phone_number ||
              lead?.phone ||
              null,
          },
        },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        console.log("✅ New Lead saved:", lead.id);
        newLeadsCount++;
      }
    } catch (err) {
      console.error("❌ Error saving lead:", err.message);
    }
  }

  if (newLeadsCount > 0) {
    const notification = {
      title: "New Lead Received",
      description: `You have ${newLeadsCount} new lead(s) from your ads`,
      customData: "default",
    };
    await sendPushNotification(busines, notification, newLeadsCount);

    // Emit real-time Socket.io event to the business room
    if (global.io && busines?.businessId?._id) {
      const businessId = busines.businessId._id.toString();
      global.io.to(`business:${businessId}`).emit("newLead", {
        count: newLeadsCount,
        businessId: businessId,
        message: `${newLeadsCount} new lead(s) received`,
        timestamp: new Date().toISOString(),
      });
      console.log(`[LeadData] Emitted newLead event to business:${businessId} (${newLeadsCount} leads)`);
    }
  }
}

async function fetchLeadForms(pageId, accessToken) {
  const url = `https://graph.facebook.com/v19.0/${pageId}/leadgen_forms`;
  const response = await axios.get(url, {
    params: { access_token: accessToken },
  });
  return response.data.data || [];
}

async function fetchLeads(formId, accessToken, afterCursor = null) {
  const leads = [];
  let nextCursor = afterCursor;

  do {
    const response = await axios.get(`https://graph.facebook.com/v21.0/${formId}/leads`, {
      params: {
        access_token: accessToken,
        limit: 500,
        after: nextCursor,
        fields: "created_time,ad_id,adset_id,campaign_id,field_data",
      },
    });

    for (const lead of response.data.data) {
      const entry = {
        id: lead.id,
        created_time: lead.created_time,
        ad_id: lead.ad_id || null,
        adset_id: lead.adset_id || null,
        campaign_id: lead.campaign_id || null,
      };
      if (lead.field_data) {
        lead.field_data.forEach((field) => {
          entry[field?.name] = field?.values?.join(", ");
        });
      }
      leads.push(entry);
    }

    nextCursor = response.data.paging?.cursors?.after || null;
  } while (nextCursor);

  return leads;
}

async function sendPushNotification(campaign, notification, newLeadsCount) {
  try {
    const busines = await business.findById(campaign._id || campaign.businessId);
    const userId = busines?.userId || busines?.businessId?.userId;
    if (userId) {
      await sendLeadNotification({
        userId,
        businessId: busines?._id,
        campaignId: campaign._id,
        campaignName: campaign.campaignName || campaign.mainAdId,
        count: newLeadsCount || 1,
      });
    }
  } catch (err) {
    console.error("❌ Error sending lead notification in LeadData:", err.message);
  }
}

module.exports = {
  fetchLeadsFromMetaAPI,
  saveLeadsIfNotExist
};
