const faqModel = require("../models/faqModel");

const INITIAL_FAQS = [
  {
    question: "How do I create and launch a new Ad campaign?",
    answer: "Navigate to the Ads section, click 'Create Ad', choose your objective (Lead Ads, Call Ads, or WhatsApp Ads), set your daily budget, select your target audience, and submit.",
    type: "ALL",
    disable: false,
  },
  {
    question: "How can I download my official GST Invoice?",
    answer: "Go to the Invoice section from the sidebar or user menu, locate your invoice number, and click 'Download' for a complete single-page PDF invoice complete with QR code and GST breakdown.",
    type: "ALL",
    disable: false,
  },
  {
    question: "What are the available Ad Plans and packages?",
    answer: "We offer flexible starter plans from 1-day ₹245 trial campaigns up to 30-day and 50-day monthly enterprise growth plans with guaranteed reach, clicks, and verified lead counts.",
    type: "ADD_PLAN",
    disable: false,
  },
  {
    question: "How does AI Creative and Image generation work?",
    answer: "Our AI engine analyzes your business category, services, and branding to generate high-converting promotional banners in Square (1:1), Story (9:16), and Landscape (16:9) formats.",
    type: "AI_IMAGE",
    disable: false,
  },
  {
    question: "Where can I monitor real-time Ad Reports and ROI?",
    answer: "Check the 'Live Ads' and 'Ads' tabs to track real-time impressions, reach, click-through rate (CTR), cost per lead (CPL), and total ad spend synced directly with Meta.",
    type: "AD_REPORT",
    disable: false,
  },
  {
    question: "How do I top up my user wallet?",
    answer: "Click 'Top up User Wallet' or select 'Add Money' in the mobile app. You can pay securely via UPI, Credit/Debit cards, or Net Banking powered by Razorpay.",
    type: "ALL",
    disable: false,
  },
  {
    question: "Can I pause, edit or stop an active ad campaign?",
    answer: "Yes, you can pause or stop any live campaign at any time directly from the Live Ads dashboard. Any unspent daily budget automatically stays in your wallet balance.",
    type: "ADD_PLAN",
    disable: false,
  },
  {
    question: "What is the difference between Main Wallet and WhatsApp Wallet?",
    answer: "The Main Wallet is used for funding Meta Facebook and Instagram ad campaigns, while the WhatsApp Wallet is dedicated to verified WhatsApp bulk messaging and template broadcasts.",
    type: "ALL",
    disable: false,
  },
];

async function seedFaqsIfEmpty() {
  try {
    const count = await faqModel.countDocuments();
    if (count < 4) {
      for (const faq of INITIAL_FAQS) {
        const exists = await faqModel.findOne({ question: faq.question });
        if (!exists) {
          await faqModel.create(faq);
        }
      }
      console.log("✅ Seeded initial MarketingKart FAQs successfully");
    }
  } catch (error) {
    console.error("❌ Failed to seed FAQs:", error.message);
  }
}

module.exports = { seedFaqsIfEmpty };
