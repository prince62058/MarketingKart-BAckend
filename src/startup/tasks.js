const { manageCampaigns } = require("../controllers/adsRunChecking");
const { startFollowUpScheduler } = require("../controllers/fowllowUpController");
const { startWhatsAppWorker } = require("../workers/whatsappWorker");
const { startLiveSpendSync } = require("./liveSpendSync");

async function initializeBackgroundTasks() {
    console.log("🚀 Initializing background tasks...");
    try {
        // Start the manual campaign manager (starts its own 5s loop)
        manageCampaigns();

        // Start the follow-up reminder scheduler (1 min loop)
        startFollowUpScheduler();

        // Start WhatsApp BullMQ worker for bulk messaging
        startWhatsAppWorker();

        // Keep Meta spend live in DB (wallet Ad Spent + ads metrics) every 30s
        startLiveSpendSync(30 * 1000);

        console.log("✅ Background tasks initialized successfully.");
    } catch (error) {
        console.error("❌ Failed to initialize background tasks:", error);
    }
}

module.exports = { initializeBackgroundTasks };
