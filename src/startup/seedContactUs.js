const ContactUs = require("../models/contactUsModel");

const INITIAL_CONTACT_SUBMISSIONS = [
  {
    name: "Rohit Verma",
    email: "rohit.verma@fashionhub.in",
    phone: "+91 9811223344",
    message: "Interested in the Monthly Lead Generation Package for my e-commerce clothing brand. Can you share past case studies and how fast we can scale to 500+ orders?",
    status: "PENDING",
  },
  {
    name: "Meenakshi Sundaram",
    email: "meenakshi@southtiffin.com",
    phone: "+91 9840112233",
    message: "Can we connect our official WhatsApp Cloud API number with MarketingKart to automate daily promotional menu broadcasts and catalog orders?",
    status: "RESOLVED",
  },
  {
    name: "Dr. Alok Gupta",
    email: "dralokgupta@dentalcare.org",
    phone: "+91 9711889900",
    message: "Need targeted Facebook & Instagram lead ads for our multi-specialty dental clinic in South Delhi. Please share the recommended budget and expected CPL.",
    status: "IN_PROGRESS",
  },
  {
    name: "Vikram Singhania",
    email: "vikram@singhaniaproperties.com",
    phone: "+91 9920334455",
    message: "We want to run high-budget real estate lead generation campaigns for luxury 3BHK flats in Noida Expressway. Please arrange an executive call back.",
    status: "PENDING",
  },
  {
    name: "Pooja Sharma",
    email: "pooja.baker@sweetdelights.co.in",
    phone: "+91 9871556677",
    message: "Loved the AI image creative generator! Wanted to confirm if custom video reel generation is also supported for festival bakery launches.",
    status: "RESOLVED",
  },
];

async function seedContactUsIfEmpty() {
  try {
    const count = await ContactUs.countDocuments();
    if (count === 0) {
      for (const item of INITIAL_CONTACT_SUBMISSIONS) {
        await ContactUs.create(item);
      }
      console.log("✅ Seeded initial Contact Us submissions successfully");
    }
  } catch (error) {
    console.error("❌ Failed to seed Contact Us:", error.message);
  }
}

module.exports = { seedContactUsIfEmpty };
