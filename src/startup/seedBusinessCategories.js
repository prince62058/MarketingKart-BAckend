const categoryModel = require("../models/businessCategoryModel");

const CATEGORIES_DATA = [
  { title: "Legal", icon: "⚖️", orderNumber: 1 },
  { title: "Jewellery", icon: "💎", orderNumber: 2 },
  { title: "Hotel & Resorts", icon: "🏨", orderNumber: 3 },
  { title: "Home Decor", icon: "🏠", orderNumber: 4 },
  { title: "Healthcare", icon: "🏥", orderNumber: 5 },
  { title: "Gym & Fitness", icon: "💪", orderNumber: 6 },
  { title: "Furniture", icon: "🛋️", orderNumber: 7 },
  { title: "Food & Restaurant", icon: "🍽️", orderNumber: 8 },
  { title: "Fashion & Apparel", icon: "👗", orderNumber: 9 },
  { title: "Events & Wedding", icon: "💍", orderNumber: 10 },
  { title: "Electrical", icon: "⚡", orderNumber: 11 },
  { title: "Education", icon: "📚", orderNumber: 12 },
  { title: "Dry Cleaners", icon: "👔", orderNumber: 13 },
  { title: "Dairy & Sweets", icon: "🥛", orderNumber: 14 },
  { title: "Computer & Networking", icon: "💻", orderNumber: 15 },
  { title: "Cleaning & Pest Control", icon: "🧹", orderNumber: 16 },
  { title: "Banking & Finance", icon: "🏦", orderNumber: 17 },
  { title: "Bakery and Cake", icon: "🎂", orderNumber: 18 },
  { title: "Automobile", icon: "🚗", orderNumber: 19 },
  { title: "Astrology", icon: "🔮", orderNumber: 20 },
  { title: "Art & Entertainments", icon: "🎭", orderNumber: 21 },
  { title: "Marketing & Advertising", icon: "📣", orderNumber: 22 },
  { title: "Real Estate & Builders", icon: "🏗️", orderNumber: 23 },
  { title: "Salon & Spa", icon: "💅", orderNumber: 24 },
  { title: "Tours & Travels", icon: "✈️", orderNumber: 25 },
  { title: "E-Commerce & Retail", icon: "🛍️", orderNumber: 26 },
  { title: "Photography & Studio", icon: "📸", orderNumber: 27 },
  { title: "Agriculture & Farming", icon: "🌾", orderNumber: 28 },
  { title: "Logistics & Transport", icon: "🚚", orderNumber: 29 },
  { title: "Pet Care & Veterinary", icon: "🐾", orderNumber: 30 },
  { title: "Solar & Green Energy", icon: "☀️", orderNumber: 31 },
  { title: "Interior Design", icon: "🎨", orderNumber: 32 },
  { title: "Software & IT Services", icon: "🖥️", orderNumber: 33 },
  { title: "Printing & Packaging", icon: "🖨️", orderNumber: 34 },
  { title: "Music & Dance Academy", icon: "🎵", orderNumber: 35 },
  { title: "Sports & Recreation", icon: "⚽", orderNumber: 36 },
  { title: "Security & Surveillance", icon: "🛡️", orderNumber: 37 },
  { title: "Car Spa & Detailing", icon: "🚘", orderNumber: 38 },
  { title: "Coaching & Tutorials", icon: "🎓", orderNumber: 39 },
  { title: "Digital Creator", icon: "📱", orderNumber: 40 },
];

async function seedCategoriesIfEmpty() {
  try {
    for (const cat of CATEGORIES_DATA) {
      await categoryModel.findOneAndUpdate(
        { title: cat.title },
        {
          $setOnInsert: {
            title: cat.title,
            icon: cat.icon,
            orderNumber: cat.orderNumber,
            disable: false,
            categoryId: null,
          },
        },
        { upsert: true, new: true }
      );
    }
  } catch (error) {
    console.error("❌ Failed to auto-seed business categories:", error);
  }
}

module.exports = { seedCategoriesIfEmpty };
