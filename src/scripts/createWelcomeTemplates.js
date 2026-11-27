// Submits the three welcome templates (Meta Ads app, WhatsApp Marketing, AI Video) to Meta for
// approval on the company's own WhatsApp number. Run it ON THE SERVER after deploying, so the
// header images at https://api.marketingkart.in/images/welcome/*.jpg are public.
//
//   1. Connect the company number in the WhatsApp panel.
//   2. Set WELCOME_WHATSAPP_PHONE_NUMBER_ID (and WELCOME_CALL_NUMBER for a Call button) in .env.
//   3. node src/scripts/createWelcomeTemplates.js --dry-run     # prints what would be sent
//      node src/scripts/createWelcomeTemplates.js               # submits all three
//      node src/scripts/createWelcomeTemplates.js meta_ads      # just one
//
// Once Meta approves them, every new sign-in gets its product's welcome automatically.
require("dotenv").config();
const mongoose = require("mongoose");
const welcome = require("../services/whatsappWelcomeService");
const cloud = require("../services/whatsappCloudApiService");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.filter((a) => !a.startsWith("--"));
const products = Object.keys(welcome.PRODUCTS).filter((p) => !only.length || only.includes(p));

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) throw new Error("Set MONGO_URI (the app's database).");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const credentials = await welcome.senderCredentials();
  if (!credentials) throw new Error("Set WELCOME_WHATSAPP_PHONE_NUMBER_ID to a CONNECTED number's phone number id.");
  console.log(`Sender ${credentials.phoneNumberId} (WABA ${credentials.wabaId}). Call button: ${welcome.callNumber() || "none — quick reply instead"}`);

  for (const product of products) {
    const { template } = welcome.PRODUCTS[product];
    const payload = { name: template, category: "MARKETING", language: welcome.LANGUAGE, components: welcome.templateComponents(product), allow_category_change: false };
    if (dryRun) {
      console.log(`\n--- ${product}\n${JSON.stringify(payload, null, 2)}`);
      continue;
    }
    try {
      const result = await cloud.uploadTemplateToMeta(payload, { accessToken: credentials.accessToken, wabaId: credentials.wabaId });
      console.log(`✔ ${template}: submitted (id ${result?.id}, status ${result?.status})`);
    } catch (error) {
      console.error(`✘ ${template}: ${error.message}`);
    }
  }
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
