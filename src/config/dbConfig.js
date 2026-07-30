const mongoose = require("mongoose");
const { defaultResponseMessage } = require("../Message/defaultMessage");
const adminModel = require("../models/userModel");
const advertisementModel = require("../models/advertisementModel");
const homepageModel = require("../models/homepageModel");
mongoose.set("strictQuery", true); // Suppress strictQuery deprecation warning
const logger = require("../utils/logger");
const CryptoJS = require("crypto-js");
const companyModel = require("../models/commpanyModelV2");

const log = logger || console;

const DEFAULT_POOL_SIZE = parseInt(process.env.MONGO_MAX_POOL_SIZE || "50", 10);
const DEFAULT_MIN_POOL_SIZE = parseInt(
  process.env.MONGO_MIN_POOL_SIZE || "1",
  10,
);
const SERVER_SELECTION_TIMEOUT = parseInt(
  process.env.MONGO_SERVER_SELECTION_TIMEOUT || "90000",
  10,
);
const SOCKET_TIMEOUT = parseInt(
  process.env.MONGO_SOCKET_TIMEOUT || "60000",
  10,
);
const WAIT_QUEUE_TIMEOUT = parseInt(
  process.env.MONGO_WAIT_QUEUE_TIMEOUT || "30000",
  10,
);

const additionalConnections = new Map();

const resolveReadPreference = () => {
  const configured = (
    process.env.MONGO_READ_PREFERENCE || "primary"
  ).toLowerCase();
  if (configured !== "primary") {
    log.warn?.(
      `Configured read preference "${configured}" is not supported for transactions; defaulting to "primary"`,
    );
  }

  return "primary";
};

const baseConnectionOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  bufferCommands: true, // Allow buffering to prevent "bufferCommands = false" errors
  retryWrites: process.env.MONGO_RETRY_WRITES
    ? process.env.MONGO_RETRY_WRITES === "true"
    : true,
  w: process.env.MONGO_WRITE_CONCERN || "majority",
  readPreference: resolveReadPreference(),
  maxPoolSize: DEFAULT_POOL_SIZE,
  minPoolSize: DEFAULT_MIN_POOL_SIZE,
  serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT,
  socketTimeoutMS: SOCKET_TIMEOUT,
  waitQueueTimeoutMS: WAIT_QUEUE_TIMEOUT,
  appName: process.env.MONGO_APP_NAME || "leadkart-api",
};

const readAdditionalDatabaseConfig = () => {
  if (!process.env.MONGO_ADDITIONAL_DBS) {
    return [];
  }

  try {
    const parsed = JSON.parse(process.env.MONGO_ADDITIONAL_DBS);
    if (!Array.isArray(parsed)) {
      log.warn?.(
        "MONGO_ADDITIONAL_DBS must be a JSON array of { name, uri, options } objects",
      );
      return [];
    }
    return parsed.filter((entry) => entry?.name && entry?.uri);
  } catch (error) {
    log.error?.("Failed to parse MONGO_ADDITIONAL_DBS", error);
    return [];
  }
};

const connectAdditionalDatabases = async () => {
  const additionalDbs = readAdditionalDatabaseConfig();

  await Promise.all(
    additionalDbs.map(async ({ name, uri, options = {} }) => {
      if (additionalConnections.has(name)) {
        return;
      }

      const connection = mongoose.createConnection(uri, {
        ...baseConnectionOptions,
        ...options,
      });

      try {
        await connection.asPromise();
        additionalConnections.set(name, connection);
        log.info?.(`Connected to secondary database: ${name}`);
      } catch (error) {
        log.error?.(
          `Failed to connect to secondary database "${name}": ${error.message}`,
          error,
        );
        throw error;
      }
    }),
  );
};

const connect = async () => {
  const primaryUri =
    process.env.MONGO_URI ||
    "mongodb+srv://leadkartai:JFahjNo8JikXZeQL@leadkart.d7ppzbt.mongodb.net/Leadkart?retryWrites=true&w=majority";

  try {
    await mongoose.connect(primaryUri, baseConnectionOptions);
    await connectAdditionalDatabases();

    // await initializeAdmin();
    attachConnectionListeners(mongoose.connection);

    log.info?.(defaultResponseMessage?.DATABASE);
  } catch (error) {
    log.error?.(
      `${defaultResponseMessage?.DATABASE_ERROR} Error message: ${error.message}`,
      {
        error,
        stack: error.stack,
        config: error.config,
      },
    );
    process.exit(1);
  }
};

async function initializeAdmin() {
  try {
    const adminCount = await adminModel.estimatedDocumentCount();
    if (adminCount === 0) {
      const cyperOtp = CryptoJS.AES.encrypt("12345678", "CRYPTOKEY").toString();
      await adminModel.create({
        _id: "64ddafdb7f21b2c8878e0001",
        email: "admin@leadkart.ai",
        userType: "ADMIN",
        password: cyperOtp,
        role: 2,
      });
      console.log("Admin user created successfully.");
    }

    const advertisementTypes = [
      "LEADS",
      "WHATSAPP_MESSAGES",
      "CALLS",
      "WEBSITE_VISITORS",
      "APP_INSTALLS",
      "VIDEO_VIEWS",
      "POST_ENGAGEMENT",
      "PAGE_LIKES",
      "EVENT_RESPONSES",
      "OFFER_CLAIMS",
      "PRODUCT_CATALOG_SALES",
      "STORE_VISITS",
    ];

    const adCount = await advertisementModel.estimatedDocumentCount();
    if (adCount === 0) {
      const advertisements = advertisementTypes.map((type) => ({
        image:
          "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/IMAGE/1723017219023_Frame%201000003269.png",
        title: `Sample Advertisement for ${type}`,
        description: `This is a sample advertisement for ${type}.`,
        isInstagram: false,
        isFacebook: false,
        isGoogle: false,
        advertisementType: type,
        minimumBudget: 0,
      }));

      await advertisementModel.insertMany(advertisements);
      console.log("Sample advertisements created successfully.");
    }

    const homepageCount = await homepageModel.estimatedDocumentCount();
    if (homepageCount === 0) {
      await homepageModel.create({
        title: "Need Assistance With Lead Generation?",
        subTitle:
          "Need Assistance With Lead Generation. We Are Here To Help You.",
        banner:
          "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/OTHERS/Kgf.png",
        contactNumber: 1234567890,
        image: [
          {
            image:
              "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/PDF/WhatsApp%20Image%202024-12-25%20at%205.30.20%20PM.jpeg",
            icon: "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/PDF/WhatsApp%20Image%202024-12-25%20at%205.30.21%20PM.jpeg",
            Title: "Ai Meta Content",
          },
          {
            image:
              "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/PDF/WhatsApp%20Image%202024-12-25%20at%205.30.20%20PM-2.jpeg",
            icon: "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/PDF/aiGen.gif",
            Title: "Ai Add Generation",
          },
          {
            image:
              "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/PDF/WhatsApp%20Image%202024-12-25%20at%205.30.20%20PM-3.jpeg",
            icon: "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/PDF/lead.gif",
            Title: "Lead",
          },
          {
            image:
              "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/PDF/WhatsApp%20Image%202024-12-25%20at%205.30.22%20PM.jpeg",
            icon: "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/PDF/AD.gif",
            Title: "Add Report",
          },
        ],
      });
      console.log("Homepage content created successfully.");
    }

    const companyCount = await companyModel.estimatedDocumentCount();
    if (companyCount === 0) {
      await companyModel.create({
        name: "LeadKart Pvt Ltd",
        address: "1234 LeadKart Street, Lead City, LK 56789",
        phone: "123-456-7890",
        email: "info@leadkart.ai",
        website: "https://www.leadkart.ai",
        favicon:
          "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/IMAGE/favicon.ico",
        logo: "https://leadkart.in-maa-1.linodeobjects.com/LEADKART/IMAGE/logo.png",
        returnPolicy: "This is the return policy of LeadKart Pvt Ltd.",
        termsAndConditions:
          "These are the terms and conditions of LeadKart Pvt Ltd.",
        privacyPolicy: "This is the privacy policy of LeadKart Pvt Ltd.",
      });
      console.log("Company data created successfully.");
    }
  } catch (error) {
    console.error("Error during database initialization:", error.message);
  }
}

const getConnection = (name = "primary") => {
  if (name === "primary") {
    return mongoose.connection;
  }

  return additionalConnections.get(name);
};

const attachConnectionListeners = (connection) => {
  connection.on("connected", () => {
    log.info?.("MongoDB connected to " + connection.name);
  });
  connection.on("reconnected", () => log.info?.("MongoDB reconnected"));
  connection.on("disconnected", () => log.warn?.("MongoDB disconnected"));
  connection.on("error", (err) => {
    log.error?.("MongoDB connection error: " + err.message, err);
  });
  connection.on("fullsetup", () =>
    log.info?.("MongoDB fullsetup (all nodes connected)"),
  );
  connection.on("all", () =>
    log.info?.("MongoDB all (all nodes connected in a set)"),
  );
};

module.exports = { connect, getConnection };
